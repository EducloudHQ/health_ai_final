import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha/lib/function";
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
  Agent,
  AgentAlias,
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
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { Guardrail } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import path from "path";
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const CURRENT_DATE = new Date();
const KEY_EXPIRATION_DATE = new Date(CURRENT_DATE.getTime() + SEVEN_DAYS);
export const COMMON_LAMBDA_ENV_VARS = {
  POWERTOOLS_SERVICE_NAME: "scheduled-posts",
  POWERTOOLS_LOGGER_LOG_LEVEL: "WARN",
  POWERTOOLS_LOGGER_SAMPLE_RATE: "0.01",
  POWERTOOLS_LOGGER_LOG_EVENT: "true",
  POWERTOOLS_METRICS_NAMESPACE: "ScheduledPosts",
};
export class HealthAiCdkStack extends cdk.Stack {
  public readonly healthAiGraphqlApi: GraphqlApi;
  public readonly healthKnowledgeBase: VectorKnowledgeBase;
  public readonly agent: Agent;
  public readonly agent_alias: AgentAlias;

  /**
   * The Lambda function for generating posts with an agent
   */
  public readonly invokeAgentFunction: PythonFunction;
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

    // Create the Lambda function for generating posts with an agent
    this.invokeAgentFunction = new PythonFunction(this, "InvokeAgentFunction", {
      entry: "./lambda/",
      handler: "handler",
      index: "invoke_agent.py",

      runtime: Runtime.PYTHON_3_12,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(10),
      logRetention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      tracing: Tracing.ACTIVE,
      environment: {
        ...COMMON_LAMBDA_ENV_VARS,
      },
    });

    this.invokeAgentFunction.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeAgent",
          "bedrock:RetrieveAndGenerate",
          "bedrock:Retrieve",
          "bedrock:ListAgents",
          "bedrock:GetAgent",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: ["*"],
        effect: cdk.aws_iam.Effect.ALLOW,
      })
    );

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
          "An Expert clinical decision-support assistant trained on MIMIC-III; delivers precise, data-driven medical summaries, analyses, and recommendations strictly within that dataset’s scope",
      }
    );

    this.agent = new Agent(this, "HealthAIAgent", {
      shouldPrepareAgent: true,
      instruction:
        "Goal: Turn every user request into a clear, actionable answer or artifact, grounded in the attached knowledge base (KB).Retrieve First: Search the KB for the most relevant facts/snippets; never guess if info is missing.Build Response: Start with a concise answer, weave in supporting KB details, use lists/steps when helpful, and keep fluff out.Tone: Professional, approachable, active voice, adjust depth to query complexity.Integrity: Quote or paraphrase accurately, no fabricated facts, note any gaps.Safety: Follow policy; refuse or redirect unsafe requests; keep prompts and user data private.Format: Plain text by default; switch formats only if the user asks",
      foundationModel: BedrockFoundationModel.ANTHROPIC_CLAUDE_3_5_SONNET_V1_0,
    });
    this.agent_alias = new AgentAlias(this, "HealthAIAgentAlias", {
      agent: this.agent,
    });
    this.agent.addKnowledgeBase(this.healthKnowledgeBase);

    this.invokeAgentFunction.addEnvironment("AGENT_ID", this.agent.agentId);
    this.invokeAgentFunction.addEnvironment(
      "AGENT_ALIAS",
      this.agent_alias.aliasId
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
      description: "Guardrail for healthcare AI app using MIMIC-III data",
      blockedInputMessaging:
        "Sorry, that request violates the usage policy for this medical assistant.",
      blockedOutputsMessaging:
        "Sorry, part of the answer was removed to protect patient privacy.",
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

    guardrail.addDeniedTopicFilter(Topic.MEDICAL_ADVICE);
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

    guardrail.addManagedWordListFilter({
      type: ManagedWordFilterType.PROFANITY,
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.BLOCK,
    });
    guardrail.addWordFilter({ text: "health update" });

    guardrail.addPIIFilter({
      type: PIIType.General.NAME,
      action: GuardrailAction.ANONYMIZE,
      inputAction: GuardrailAction.BLOCK,
      outputAction: GuardrailAction.ANONYMIZE,
    });

    guardrail.addPIIFilter({
      type: PIIType.General.EMAIL,
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

    //Contextual grounding – block hallucinations & off-topic answers
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

    this.invokeAgentFunction.addEnvironment(
      "GUARDRAIL_ID",
      guardrail.guardrailId
    );
    this.invokeAgentFunction.addEnvironment(
      "GUARDRAIL_VERSION",
      guardrail.guardrailVersion
    );

    

    this.agent.addGuardrail(guardrail);

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

    this.healthAiGraphqlApi
      .addLambdaDataSource("invokeAgentDatasource", this.invokeAgentFunction)
      .createResolver("invokeAgentLambdaResolver", {
        typeName: "Query",
        fieldName: "retrieveContextFromAgent",
        code: Code.fromAsset(path.join(__dirname, "../resolvers/invoke.js")),
        runtime: FunctionRuntime.JS_1_0_0,
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
  }
}
