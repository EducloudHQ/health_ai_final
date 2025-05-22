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

    this.healthAiGraphqlApi.addEnvironmentVariable(
      "KNOWLEDGEBASE_ID",
      this.healthKnowledgeBase.knowledgeBaseId
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

      resources: ["*"],
    });

    bedrockRetrieveAndGenerateDS.grantPrincipal.addToPrincipalPolicy(
      allowInvokeStmt
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
