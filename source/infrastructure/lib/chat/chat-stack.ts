/**********************************************************************************************************************
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                                *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

import { StackProps, NestedStack, Duration } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
// import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";
import { join } from "path";

import { Constants } from "../shared/constants";
import { QueueConstruct } from "./chat-queue";
import { IAMHelper } from "../shared/iam-helper";
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
// import * as appscaling from "aws-cdk-lib/aws-applicationautoscaling";
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { SystemConfig } from "../shared/types";
import { SharedConstructOutputs } from "../shared/shared-construct";
import { ModelConstructOutputs } from "../model/model-construct";
import { ChatTablesConstruct } from "./chat-tables";
import { ConnectConstruct } from "../connect/connect-construct";
// import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";


interface ChatStackProps extends StackProps {
  readonly config: SystemConfig;
  readonly sharedConstructOutputs: SharedConstructOutputs;
  readonly modelConstructOutputs: ModelConstructOutputs;
  readonly domainEndpoint?: string;
}

export interface ChatStackOutputs {
  sessionsTableName: string;
  messagesTableName: string;
  promptTableName: string;
  intentionTableName: string;
  sqsStatement: iam.PolicyStatement;
  messageQueue: Queue;
  dlq: Queue;
  albDomainEndpoint: string;
}

export class ChatStack extends NestedStack implements ChatStackOutputs {

  public sessionsTableName: string;
  public messagesTableName: string;
  public promptTableName: string;
  public intentionTableName: string;
  public stopSignalsTableName: string;
  public sqsStatement: iam.PolicyStatement;
  public messageQueue: Queue;
  public dlq: Queue;
  public albDomainEndpoint: string;

  private iamHelper: IAMHelper;
  private indexTableName: string;
  private modelTableName: string;
  public ecsService: ecs.FargateService;
  public loadBalancer: elbv2.ApplicationLoadBalancer;
  public listener: elbv2.ApplicationListener;
  public container: ecs.ContainerDefinition;

  constructor(scope: Construct, id: string, props: ChatStackProps) {
    super(scope, id);

    this.iamHelper = props.sharedConstructOutputs.iamHelper;
    const vpc = props.sharedConstructOutputs.vpc;
    const securityGroups = props.sharedConstructOutputs.securityGroups;
    const domainEndpoint = props.domainEndpoint ?? '';

    const chatTablesConstruct = new ChatTablesConstruct(this, "chat-tables");

    this.sessionsTableName = chatTablesConstruct.sessionsTableName;
    this.messagesTableName = chatTablesConstruct.messagesTableName;
    this.promptTableName = chatTablesConstruct.promptTableName;
    this.intentionTableName = chatTablesConstruct.intentionTableName;
    this.stopSignalsTableName = chatTablesConstruct.stopSignalsTableName;
    this.indexTableName = props.sharedConstructOutputs.indexTable.tableName;
    this.modelTableName = props.sharedConstructOutputs.modelTable.tableName;

    const chatQueueConstruct = new QueueConstruct(this, "LLMQueueStack", {
      namePrefix: Constants.API_QUEUE_NAME,
    });
    this.sqsStatement = chatQueueConstruct.sqsStatement;
    this.messageQueue = chatQueueConstruct.messageQueue;
    this.dlq = chatQueueConstruct.dlq;

    const openAiKey = new secretsmanager.Secret(this, "OpenAiSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ key: "ReplaceItWithRealKey" }),
        generateStringKey: "key",
      }
    });

    // Add custom domain secret arn to environment variables
    let customDomainSecretArn;
    if (props.config.knowledgeBase.knowledgeBaseType.intelliAgentKb.vectorStore.opensearch.useCustomDomain) {
      customDomainSecretArn = props.config.knowledgeBase.knowledgeBaseType.intelliAgentKb.vectorStore.opensearch.customDomainSecretArn;
    } else {
      customDomainSecretArn = "";
    }

    const cluster = new ecs.Cluster(this, 'ChatCluster', {
      vpc,
    });

    const taskRole = new iam.Role(this, 'ChatTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "es:ESHttpGet",
        "es:ESHttpPut",
        "es:ESHttpPost",
        "es:ESHttpHead",
        "es:DescribeDomain",
        "secretsmanager:GetSecretValue",
        "bedrock:*",
        "lambda:InvokeFunction",
        "secretmanager:GetSecretValue",
        "cases:*",
        "connect:*",
        "cloudformation:Describe*",
        "cloudformation:EstimateTemplateCost",
        "cloudformation:Get*",
        "cloudformation:List*",
        "cloudformation:ValidateTemplate",
        "cloudformation:Detect*",
      ],
      effect: iam.Effect.ALLOW,
      resources: ["*"],
    }));

    taskRole.addToPolicy(this.sqsStatement);
    taskRole.addToPolicy(this.iamHelper.s3Statement);
    taskRole.addToPolicy(this.iamHelper.endpointStatement);
    taskRole.addToPolicy(this.iamHelper.dynamodbStatement);
    openAiKey.grantRead(taskRole);

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ChatTaskDefinition', {
      memoryLimitMiB: 4096,
      cpu: 1024,
      taskRole,
    });

    this.container = taskDefinition.addContainer('ChatContainer', {
      image: ecs.ContainerImage.fromAsset(join(__dirname, '../../../lambda/online'), {
        buildArgs: {
          REQUIREMENTS_FILE: 'requirements.txt',
        },
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:80/health || exit 1'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(10),
      },
      environment: {
        AOS_ENDPOINT: domainEndpoint,
        AOS_SECRET_ARN: customDomainSecretArn,
        RERANK_ENDPOINT: props.modelConstructOutputs.defaultEmbeddingModelName,
        EMBEDDING_ENDPOINT: props.modelConstructOutputs.defaultEmbeddingModelName,
        CHATBOT_TABLE_NAME: props.sharedConstructOutputs.chatbotTable.tableName,
        SESSIONS_TABLE_NAME: chatTablesConstruct.sessionsTableName,
        MESSAGES_TABLE_NAME: chatTablesConstruct.messagesTableName,
        PROMPT_TABLE_NAME: chatTablesConstruct.promptTableName,
        INTENTION_TABLE_NAME: chatTablesConstruct.intentionTableName,
        STOP_SIGNALS_TABLE_NAME: chatTablesConstruct.stopSignalsTableName,
        MODEL_TABLE_NAME: this.modelTableName,
        INDEX_TABLE_NAME: this.indexTableName,
        OPENAI_KEY_ARN: openAiKey.secretArn,
        CONNECT_USER_ARN: "",
        CONNECT_DOMAIN_ID: "",
        CONNECT_BOT_ID: "admin",
        KNOWLEDGE_BASE_ENABLED: props.config.knowledgeBase.enabled.toString(),
        KNOWLEDGE_BASE_TYPE: JSON.stringify(props.config.knowledgeBase.knowledgeBaseType || {}),
        BEDROCK_REGION: props.config.chat.bedrockRegion,
        BEDROCK_AWS_ACCESS_KEY_ID: props.config.chat.bedrockAk || "",
        BEDROCK_AWS_SECRET_ACCESS_KEY: props.config.chat.bedrockSk || "",
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ChatService',
        logRetention: logs.RetentionDays.ONE_MONTH,
      }),
      portMappings: [
        {
          containerPort: 80,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'ChatLoadBalancer', {
      vpc: vpc,
      internetFacing: true,
    });

    // Create Fargate service
    this.ecsService = new ecs.FargateService(this, 'ChatService', {
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
    });


    this.listener = this.loadBalancer.addListener('ChatListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });
    
    const targetGroup = this.listener.addTargets('ChatTargetGroup', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.ecsService],
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(60),
        timeout: Duration.seconds(5),
      },
      deregistrationDelay: Duration.seconds(30),
    });
    this.albDomainEndpoint = this.loadBalancer.loadBalancerDnsName;

    if (props.config.chat.amazonConnect.enabled) {
      new ConnectConstruct(this, "connect-construct");
    }
  }
}
