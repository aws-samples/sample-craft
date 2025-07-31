#!/usr/bin/env node

import { Command } from "commander";
import { prompt } from "enquirer";
import * as fs from "fs";
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadSharedConfigFiles } from "@aws-sdk/shared-ini-file-loader";
import {
  SystemConfig,
  SupportedBedrockRegion,
  SupportedRegion,
} from "../lib/shared/types";
import { LIB_VERSION } from "./version.js";

const embeddingAndRerankingModelEndpoint = "bce-embedding-and-bge-reranker-250331-endpoint";

const embeddingModels = [
  {
    provider: "SageMaker",
    id: "bce-embedding-base_v1",
    commitId: "43972580a35ceacacd31b95b9f430f695d07dde9",
    dimensions: 768,
    modelEndpoint: embeddingAndRerankingModelEndpoint,
  },
  {
    provider: "Bedrock",
    id: "amazon.titan-embed-text-v2:0",
    commitId: "",
    dimensions: 1024,
    default: true,
  },
  {
    provider: "Bedrock",
    id: "cohere.embed-english-v3",
    commitId: "",
    dimensions: 1024,
  }
];

let rerankModels = [
  {
    provider: "Bedrock",
    id: "cohere.rerank-v3-5:0",
  },
  {
    provider: "SageMaker",
    id: "bge-reranker-large",
    modelEndpoint: embeddingAndRerankingModelEndpoint,
  },
]

let llms = [
  {
    provider: "Bedrock",
    id: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  },
  {
    provider: "SageMaker",
    id: "DeepSeek-R1-Distill-Llama-8B",
  }
]

let vlms = [
  {
    provider: "Bedrock",
    id: "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  },
  {
    provider: "SageMaker",
    id: "Qwen2-VL-72B-Instruct",
    modelEndpoint: "",
  }
]

const supportedRegions = Object.values(SupportedRegion) as string[];
const supportedBedrockRegions = Object.values(SupportedBedrockRegion) as string[];

const execPromise = promisify(exec);

// Function to get AWS account ID and region
async function getAwsAccountAndRegion() {
  let AWS_ACCOUNT;
  let AWS_REGION;

  try {
    // Execute the AWS CLI command
    const { stdout, stderr } = await execPromise('aws sts get-caller-identity');

    if (stderr) {
      throw new Error(`Command error: ${stderr}`);
    }

    // Parse the JSON response
    const response = JSON.parse(stdout);
    AWS_ACCOUNT = response.Account;
  } catch (error) {
    console.error('Error getting AWS account:', error);
    throw error;
  }

  try {
    const config = await loadSharedConfigFiles();
    AWS_REGION = config.configFile?.default?.region;
  } catch (error) {
    console.error("No default region found in the AWS credentials file. Please enter the region you want to deploy the intelli-agent solution");
    AWS_REGION = undefined;
  }

  console.log("AWS_ACCOUNT", AWS_ACCOUNT);
  console.log("AWS_REGION", AWS_REGION);
  return { AWS_ACCOUNT, AWS_REGION };
}



/**
 * Main entry point
 */

(async () => {
  let program = new Command().description(
    "Creates a new chatbot configuration"
  );
  program.version(LIB_VERSION);

  program.option("-p, --prefix <prefix>", "The prefix for the stack");

  program.action(async (options) => {
    if (fs.existsSync("./bin/config.json")) {
      const config: SystemConfig = JSON.parse(
        fs.readFileSync("./bin/config.json").toString("utf8")
      );
      options.prefix = config.prefix;
      options.intelliAgentUserEmail = config.email;
      options.intelliAgentDeployRegion = config.deployRegion;
      options.enableKnowledgeBase = config.knowledgeBase.enabled;
      options.knowledgeBaseType = config.knowledgeBase.knowledgeBaseType.intelliAgentKb.enabled
        ? "intelliAgentKb"
        : "bedrockKb";
      options.intelliAgentUserEmail = config.email;
      options.createNewVpc = config.vpc?.createNewVpc;
      options.existingVpcId = config.vpc?.existingVpcId;
      options.existingPrivateSubnetId = config.vpc?.existingPrivateSubnetId;
      options.intelliAgentKbVectorStoreType = config.knowledgeBase.knowledgeBaseType.intelliAgentKb.vectorStore.opensearch.enabled
        ? "opensearch"
        : "unsupported";
      options.useCustomDomain = config.knowledgeBase.knowledgeBaseType.intelliAgentKb.vectorStore.opensearch.useCustomDomain;
      options.customDomainEndpoint = config.knowledgeBase.knowledgeBaseType.intelliAgentKb.vectorStore.opensearch.customDomainEndpoint;
      options.customDomainSecretArn = config.knowledgeBase.knowledgeBaseType.intelliAgentKb.vectorStore.opensearch.customDomainSecretArn;
      options.enableIntelliAgentKbModel = config.knowledgeBase.knowledgeBaseType.intelliAgentKb.knowledgeBaseModel.enabled;
      options.knowledgeBaseModelEcrRepository = config.knowledgeBase.knowledgeBaseType.intelliAgentKb.knowledgeBaseModel.ecrRepository;
      options.knowledgeBaseModelEcrImageTag = config.knowledgeBase.knowledgeBaseType.intelliAgentKb.knowledgeBaseModel.ecrImageTag;
      options.defaultEmbedding = config.model.embeddingsModels && config.model.embeddingsModels.length > 0
        ? config.model.embeddingsModels[0].id
        : embeddingModels[0].id;
      options.defaultLlm = config.model.llms.find((m) => m.provider === "Bedrock")?.id;
      options.sagemakerModelS3Bucket = config.model.modelConfig.modelAssetsBucket;
    }
    try {
      await processCreateOptions(options);
    } catch (err: any) {
      console.error("Could not complete the operation.");
      console.error(err.message);
      process.exit(1);
    }
  });

  program.parse(process.argv);
})();

function createConfig(config: any): void {
  fs.writeFileSync("./bin/config.json", JSON.stringify(config, undefined, 2));
  console.log("Configuration written to ./bin/config.json");
}

/**
 * Prompts the user for missing options
 *
 * @param options Options provided via the CLI
 * @returns The complete options
 */
async function processCreateOptions(options: any): Promise<void> {
  // Get AWS account ID and region
  const { AWS_ACCOUNT, AWS_REGION } = await getAwsAccountAndRegion();
  const mandatoryQuestions = [
    {
      type: "input",
      name: "prefix",
      message: "Prefix to differentiate this deployment",
      initial: options.prefix,
      askAnswered: false,
    },
    {
      type: "input",
      name: "intelliAgentDeployRegion",
      message: "Please enter the region you want to deploy the intelli-agent solution",
      initial: options.intelliAgentDeployRegion ?? AWS_REGION,
      validate(intelliAgentDeployRegion: string) {
        if (Object.values(supportedRegions).includes(intelliAgentDeployRegion)) {
          return true;
        }
        return "Enter a valid region. Supported regions: " + supportedRegions.join(", ");
      },
    },
  ]

  const mandatoryQuestionAnswers: any = await prompt(mandatoryQuestions);
  const deployInChina = mandatoryQuestionAnswers.intelliAgentDeployRegion.includes("cn");

  let questions = [
    {
      type: "confirm",
      name: "enableIntelliAgentKbModel",
      message: "Do you want to extract PDF files or images?",
      initial: options.enableIntelliAgentKbModel ?? true,
      skip(): boolean {
        return (!(this as any).state.answers.enableKnowledgeBase ||
          (this as any).state.answers.knowledgeBaseType !== "intelliAgentKb");
      },
    },
    {
      type: "input",
      name: "knowledgeBaseModelEcrRepository",
      message: "Please enter the name of the ECR Repository for the knowledge base model",
      initial: options.knowledgeBaseModelEcrRepository ?? "intelli-agent-knowledge-base",
      validate(knowledgeBaseModelEcrRepository: string) {
        return (this as any).skipped ||
          RegExp(/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/i).test(knowledgeBaseModelEcrRepository)
          ? true
          : "Enter a valid ECR Repository Name in the specified format: (?:[a-z0-9]+(?:[._-][a-z0-9]+)*/)*[a-z0-9]+(?:[._-][a-z0-9]+)*";
      },
      skip(): boolean {
        return (!(this as any).state.answers.enableKnowledgeBase ||
          (this as any).state.answers.knowledgeBaseType !== "intelliAgentKb" ||
          !(this as any).state.answers.enableIntelliAgentKbModel);
      },
    },
    {
      type: "input",
      name: "knowledgeBaseModelEcrImageTag",
      message: "Please enter the ECR Image Tag for the knowledge base model",
      initial: options.knowledgeBaseModelEcrImageTag ?? "latest",
      validate(knowledgeBaseModelEcrImageTag: string) {
        return (this as any).skipped ||
          (RegExp(/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/i)).test(knowledgeBaseModelEcrImageTag)
          ? true
          : "Enter a valid ECR Image Tag in the specified format: ";
      },
      skip(): boolean {
        return (!(this as any).state.answers.enableKnowledgeBase ||
          (this as any).state.answers.knowledgeBaseType !== "intelliAgentKb" ||
          !(this as any).state.answers.enableIntelliAgentKbModel);
      },
    },
    {
      type: "input",
      name: "sagemakerModelS3Bucket",
      message: "Please enter the name of the S3 Bucket for the sagemaker models assets",
      initial: `intelli-agent-models-${AWS_ACCOUNT}-${mandatoryQuestionAnswers.intelliAgentDeployRegion}`,
      validate(sagemakerModelS3Bucket: string) {
        return (this as any).skipped ||
          RegExp(/^(?!(^xn--|.+-s3alias$))^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/i).test(sagemakerModelS3Bucket)
          ? true
          : "Enter a valid S3 Bucket Name in the specified format: (?!^xn--|.+-s3alias$)^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]";
      }
    },
  ];
  const answers: any = await prompt(questions);

  // Modify the config for China Region
  if (deployInChina) {
    answers.bedrockRegion = "";
    answers.defaultEmbedding = "bce-embedding-base_v1";
    answers.defaultRerankModel = "bge-reranker-large";
    answers.defaultLlm = "DeepSeek-R1-Distill-Llama-8B";
    answers.defaultVlm = "Qwen2-VL-72B-Instruct";
    llms = [];
    vlms = [
      {
        provider: "SageMaker",
        id: "Qwen2-VL-72B-Instruct",
        modelEndpoint: answers.sagemakerVlmModelEndpoint,
      }
    ]
  } else {
    answers.defaultEmbedding = "bce-embedding-base_v1";
    answers.defaultRerankModel = "bge-reranker-large";
    answers.defaultLlm = "us.anthropic.claude-3-5-sonnet-20241022-v2:0";
    answers.defaultVlm = "us.anthropic.claude-3-5-sonnet-20241022-v2:0";
  }

  // Create the config object
  const config = {
    prefix: mandatoryQuestionAnswers.prefix,
    deployRegion: mandatoryQuestionAnswers.intelliAgentDeployRegion,
    knowledgeBase: {
      enabled: true,
      knowledgeBaseType: {
        intelliAgentKb: {
          enabled: true,
          vectorStore: {
            opensearch: {
              enabled: "opensearch",
              useCustomDomain: answers.useCustomDomain,
              customDomainEndpoint: answers.customDomainEndpoint,
              customDomainSecretArn: answers.customDomainSecretArn,
            },
          },
          knowledgeBaseModel: {
            enabled: answers.enableIntelliAgentKbModel,
            ecrRepository: answers.knowledgeBaseModelEcrRepository,
            ecrImageTag: answers.knowledgeBaseModelEcrImageTag,
          },
        },
      },
    },
    model: {
      embeddingsModels: embeddingModels.filter(model => model.id === answers.defaultEmbedding),
      rerankModels: rerankModels.filter(model => model.id === answers.defaultRerankModel),
      llms: llms.filter(model => model.id === answers.defaultLlm),
      vlms: vlms.filter(model => model.id === answers.defaultVlm),
      modelConfig: {
        modelAssetsBucket: answers.sagemakerModelS3Bucket,
      },
    },
  };

  console.log("\n✨ This is the chosen configuration:\n");
  console.log(JSON.stringify(config, undefined, 4));
  (
    (await prompt([
      {
        type: "confirm",
        name: "create",
        message:
          "Do you want to create/update the configuration based on the above settings",
        initial: true,
      },
    ])) as any
  ).create
    ? createConfig(config)
    : console.log("Skipping");
}
