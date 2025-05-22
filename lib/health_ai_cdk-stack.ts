import { bedrock } from "@cdklabs/generative-ai-cdk-constructs";
import {
  VectorKnowledgeBase,
  BedrockFoundationModel,
  S3DataSource,
  ChunkingStrategy,
  ContentFilterStrength,
  ContentFilterType,
  ContextualGroundingFilterType,
  GuardrailAction,
  ManagedWordFilterType,
  ModalityType,
  PIIType,
  Topic,
} from "@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/bedrock";
import {} from "@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/bedrock";
import { PineconeVectorStore } from "@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/pinecone";
import * as cdk from "aws-cdk-lib";

import {
  GraphqlApi,
  Definition,
  FieldLogLevel,
  AuthorizationType,
  Code,
  FunctionRuntime,
} from "aws-cdk-lib/aws-appsync";
import {
  AccountRecovery,
  UserPool,
  UserPoolClient,
  VerificationEmailStyle,
} from "aws-cdk-lib/aws-cognito";
import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
} from "aws-cdk-lib/aws-iam";
import { Guardrail } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import path from "path";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const CURRENT_DATE = new Date();
const KEY_EXPIRATION_DATE = new Date(CURRENT_DATE.getTime() + SEVEN_DAYS);

export class HealthAiCdkStack extends cdk.Stack {
  public readonly healthAiGraphqlApi: GraphqlApi;
  public readonly healthKnowledgeBase: VectorKnowledgeBase;
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPool: UserPool = new UserPool(this, "health-api-userpool", {
      selfSignUpEnabled: true,
      accountRecovery: AccountRecovery.PHONE_AND_EMAIL,
      userVerification: {
        emailStyle: VerificationEmailStyle.CODE,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
    });

    const userPoolClient: UserPoolClient = new UserPoolClient(
      this,
      "HealthAIUserPoolClient",
      {
        userPool,
      }
    );

    this.healthAiGraphqlApi = new GraphqlApi(this, "health-ai-api", {
      name: "healthAPIAPIApp",
      definition: Definition.fromFile("schema/schema.graphql"),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.API_KEY,
          apiKeyConfig: {
            name: "default",
            description: "default auth mode",
            expires: cdk.Expiration.atDate(KEY_EXPIRATION_DATE),
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: AuthorizationType.USER_POOL,
            userPoolConfig: {
              userPool: userPool,
            },
          },
          { authorizationType: AuthorizationType.IAM },
        ],
      },
      xrayEnabled: true,
      logConfig: {
        fieldLogLevel: FieldLogLevel.ALL,
      },
    });

    const pinecone_vectorstore = new PineconeVectorStore({
      connectionString:
        "https://rag-with-bedrock-pinecone-pbfqwcb.svc.aped-4627-b74a.pinecone.io",
      credentialsSecretArn:
        "arn:aws:secretsmanager:us-east-1:132260253285:secret:pinecone-j4JvqP",
      textField: "text",
      metadataField: "metadata",
      namespace: "health-ai-app-namespace",
    });

    this.healthKnowledgeBase = new VectorKnowledgeBase(
      this,
      "HealthAIknowledgeBase",
      {
        name: "HealthAIknowledgeBase",
        vectorStore: pinecone_vectorstore,

        embeddingsModel: BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
        instruction:
          "You are an expert clinical decision-support assistant, with deep domain expertise derived from the comprehensive MIMIC-III Clinical Database, which contains anonymized clinical data from critical care patients. Your purpose is to provide accurate, insightful, and relevant medical summaries, analyses, and recommendations based strictly on the provided dataset",
      }
    );

    const health_ai_bucket = new cdk.aws_s3.Bucket(this, "HealthAIBucket", {
      versioned: false,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new S3DataSource(this, "HealthknowledgebaseS3Datasource", {
      bucket: health_ai_bucket,
      knowledgeBase: this.healthKnowledgeBase,

      dataSourceName: "health-i-s3-datasource",
      chunkingStrategy: ChunkingStrategy.FIXED_SIZE,
    });

    const guardrail = new bedrock.Guardrail(this, "HealthcareAIGuardrail", {
      name: "HealthcareAIGuardrail",
      description:
        "Guardrail for serverless healthcare AI app using MIMIC-III data",
      blockedInputMessaging:
        "Sorry — that request violates the usage policy for this medical assistant.",
      blockedOutputsMessaging:
        "Sorry — part of the answer was removed to protect patient privacy.",
    });

    //  Harmful-content filters (strict on both input & output)
    [
      ContentFilterType.SEXUAL,
      ContentFilterType.VIOLENCE,
      ContentFilterType.HATE,
      ContentFilterType.INSULTS,
      ContentFilterType.MISCONDUCT,
    ].forEach((type) =>
      guardrail.addContentFilter({
        type,
        inputStrength: ContentFilterStrength.HIGH,
        outputStrength: ContentFilterStrength.HIGH,
        inputAction: GuardrailAction.BLOCK,
        outputAction: GuardrailAction.BLOCK,
        inputModalities: [ModalityType.TEXT],
        outputModalities: [ModalityType.TEXT],
      })
    );

    guardrail.addContentFilter({
      type: ContentFilterType.PROMPT_ATTACK,
      inputStrength: ContentFilterStrength.HIGH,
      outputStrength: ContentFilterStrength.NONE,
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.BLOCK,
      inputModalities: [ModalityType.TEXT],
      outputModalities: [ModalityType.TEXT],
    });
    //  Denied topics ─ the assistant must not give legal / financial advice
    guardrail.addDeniedTopicFilter(Topic.FINANCIAL_ADVICE);
    guardrail.addDeniedTopicFilter(
      Topic.custom({
        name: "Legal_Advice",
        definition:
          "Guidance or suggestions on legal matters, laws, or litigation.",
        examples: [
          "Should I sue my doctor?",
          "Is this malpractice?",
          "Explain this law to me.",
        ],
        inputAction: GuardrailAction.BLOCK,
        outputAction: GuardrailAction.BLOCK,
      })
    );

    //  Word filters – profanity list + generic stop-words
    guardrail.addManagedWordListFilter({
      type: ManagedWordFilterType.PROFANITY,
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.BLOCK,
    });
    guardrail.addWordFilter({ text: "10014354" }); // example custom word

    // PII filters – anonymise or block patient identifiers
    guardrail.addPIIFilter({
      type: PIIType.General.NAME,
      action: GuardrailAction.ANONYMIZE,
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.ANONYMIZE,
    });
    guardrail.addPIIFilter({
      type: PIIType.General.ADDRESS,
      action: GuardrailAction.ANONYMIZE,
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.ANONYMIZE,
    });
    guardrail.addPIIFilter({
      type: PIIType.General.PHONE,
      action: GuardrailAction.ANONYMIZE,
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.ANONYMIZE,
    });
    guardrail.addPIIFilter({
      type: PIIType.General.AGE,
      action: GuardrailAction.BLOCK,
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.ANONYMIZE,
    });

    //  Regex filter – catch typical ICU medical-record numbers (e.g. `MRN:1234567`)
    guardrail.addRegexFilter({
      name: "ICU_MRN",
      pattern: "\\bMRN[:\\- ]?\\d{6,8}\\b",
      action: GuardrailAction.ANONYMIZE,
      description: "Mask raw Medical Record Numbers",
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.ANONYMIZE,
    });

    //   Contextual grounding – block hallucinations & off-topic answers
    guardrail.addContextualGroundingFilter({
      type: ContextualGroundingFilterType.GROUNDING,
      threshold: 0.85,
      action: GuardrailAction.BLOCK,
      enabled: true,
    });

    this.healthAiGraphqlApi.addEnvironmentVariable(
      "KNOWLEDGEBASE_ID",
      this.healthKnowledgeBase.knowledgeBaseId
    );
    this.healthAiGraphqlApi.addEnvironmentVariable(
      "FOUNDATION_MODEL_ARN",
      "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0"
    );

    this.healthAiGraphqlApi.addEnvironmentVariable(
      "GUARDRAIL_ID",
      guardrail.guardrailId
    );
    this.healthAiGraphqlApi.addEnvironmentVariable(
      "GUARDRAIL_VERSION",
      guardrail.guardrailVersion
    );

    const bedrockRetrieveAndGenerateDS =
      this.healthAiGraphqlApi.addHttpDataSource(
        "healthAIRetrieveAndGenerateDS",
        `https://bedrock-agent-runtime.us-east-1.amazonaws.com`,
        {
          authorizationConfig: {
            signingRegion: "us-east-1",
            signingServiceName: "bedrock",
          },
        }
      );

    const allowInvokeStmt = new PolicyStatement({
      sid: "AllowBedrockModelInvoke",
      effect: Effect.ALLOW,
      actions: [
        "bedrock:InvokeModel",
        "bedrock:Retrieve",
        "bedrock:RetrieveAndGenerate",
      ],

      resources: [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0",
        `arn:aws:bedrock:us-east-1:132260253285:knowledge-base/${this.healthKnowledgeBase.knowledgeBaseId}`,
        "arn:aws:bedrock:us-east-1:132260253285:guardrail/hxncc8et2exw",
      ],
    });

    const denyNoGuardrailStmt = new PolicyStatement({
      sid: "DenyInvokeWithoutGuardrail",
      effect: Effect.DENY,
      conditions: {
        Null: {
          "bedrock:GuardrailIdentifier": true,
        },
      },
      actions: [
        "bedrock:InvokeModel",
        "bedrock:Retrieve",
        "bedrock:RetrieveAndGenerate",
      ],

      resources: ["*"],
    });

    const applyGuardrail = new PolicyStatement({
      sid: "ApplyGuardrail",
      effect: Effect.ALLOW,

      actions: ["bedrock:ApplyGuardrail"],

      resources: [
        "arn:aws:bedrock:us-east-1:132260253285:guardrail/hxncc8et2exw",
      ],
    });
    bedrockRetrieveAndGenerateDS.grantPrincipal.addToPrincipalPolicy(
      allowInvokeStmt
    );

    bedrockRetrieveAndGenerateDS.grantPrincipal.addToPrincipalPolicy(
      denyNoGuardrailStmt
    );

    bedrockRetrieveAndGenerateDS.grantPrincipal.addToPrincipalPolicy(
      applyGuardrail
    );

    const retrieveAndGenerateResponseResolver =
      this.healthAiGraphqlApi.createResolver(
        "healthAIRetrieveKnowledgeBaseInfo",

        {
          typeName: "Query",
          fieldName: "retrieveAndGenerateResponse",
          dataSource: bedrockRetrieveAndGenerateDS,
          runtime: FunctionRuntime.JS_1_0_0,
          code: Code.fromAsset(
            path.join(__dirname, "../resolvers/retrieveAndGenerateResponse.js")
          ),
        }
      );

    const applyGuardrailResolver = this.healthAiGraphqlApi.createResolver(
      "applyGuardrailResolver",

      {
        typeName: "Query",
        fieldName: "applyGuardrail",
        dataSource: bedrockRetrieveAndGenerateDS,
        runtime: FunctionRuntime.JS_1_0_0,
        code: Code.fromAsset(
          path.join(__dirname, "../resolvers/applyGuardrail.js")
        ),
      }
    );
  }
}
