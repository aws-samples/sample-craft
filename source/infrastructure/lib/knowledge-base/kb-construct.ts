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

import { Duration, StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { DynamoDBTable } from "../shared/table";
import { RemovalPolicy } from "aws-cdk-lib";
import { IAMHelper } from "../shared/iam-helper";

import { SystemConfig } from "../shared/types";
import { SharedConstructOutputs } from "../shared/shared-construct";
import { ModelConstructOutputs } from "../model/model-construct";


interface KnowledgeBaseStackProps extends StackProps {
  readonly config: SystemConfig;
  readonly sharedConstructOutputs: SharedConstructOutputs
  readonly modelConstructOutputs: ModelConstructOutputs;
  readonly uiPortalBucketName?: string;
}

export interface KnowledgeBaseStackOutputs {
  readonly ecsService: ecs.FargateService;
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly executionTableName: string;
  readonly etlObjTableName: string;
  readonly etlObjIndexName: string;
}

export class KnowledgeBaseStack extends Construct implements KnowledgeBaseStackOutputs {
  public etlObjIndexName: string = "ExecutionIdIndex";
  public executionTableName: string = "";
  public etlObjTableName: string = "";
  public ecsService: ecs.FargateService;
  public loadBalancer: elbv2.ApplicationLoadBalancer;

  private iamHelper: IAMHelper;
  private glueResultBucket: s3.Bucket;
  private dynamodbStatement: iam.PolicyStatement;


  constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
    super(scope, id);

    this.iamHelper = props.sharedConstructOutputs.iamHelper;
    this.glueResultBucket = props.sharedConstructOutputs.resultBucket;


    const createKnowledgeBaseTablesAndPoliciesResult = this.createKnowledgeBaseTablesAndPolicies();
    this.executionTableName = createKnowledgeBaseTablesAndPoliciesResult.executionTable.tableName;
    this.etlObjTableName = createKnowledgeBaseTablesAndPoliciesResult.etlObjTable.tableName;
    this.dynamodbStatement = createKnowledgeBaseTablesAndPoliciesResult.dynamodbStatement;

    const ecsResult = this.createKnowledgeBaseECS(props);
    this.ecsService = ecsResult.service;
    this.loadBalancer = ecsResult.loadBalancer;

  }

  private createKnowledgeBaseTablesAndPolicies() {
    const idAttr = {
      name: "executionId",
      type: dynamodb.AttributeType.STRING,
    }
    const etlS3Path = {
      name: "s3Path",
      type: dynamodb.AttributeType.STRING,
    }
    const executionTable = new DynamoDBTable(this, "Execution", idAttr).table;
    executionTable.addGlobalSecondaryIndex({
      indexName: "BucketAndPrefixIndex",
      partitionKey: { name: "s3Bucket", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "s3Prefix", type: dynamodb.AttributeType.STRING },
    });
    const etlObjTable = new DynamoDBTable(this, "ETLObject", etlS3Path, idAttr).table;
    etlObjTable.addGlobalSecondaryIndex({
      indexName: this.etlObjIndexName,
      partitionKey: { name: "executionId", type: dynamodb.AttributeType.STRING },
    });

    const dynamodbStatement = this.iamHelper.createPolicyStatement(
      [
        "dynamodb:Query",
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Describe*",
        "dynamodb:List*",
        "dynamodb:Scan",
      ],
      [
        executionTable.tableArn,
        etlObjTable.tableArn,
      ],
    );

    return { executionTable, etlObjTable, dynamodbStatement };
  }


  private createKnowledgeBaseECS(props: any) {
    const deployRegion = props.config.deployRegion;

    // Create VPC for ECS
    const vpc = props.sharedConstructOutputs.vpc;

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, "ETLCluster", {
      vpc: vpc,
      clusterName: "knowledge-base-etl-cluster",
    });

    // Create ECR Repository
    const repository = new ecr.Repository(this, "ETLRepository", {
      repositoryName: "knowledge-base-etl",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, "ETLLogGroup", {
      logGroupName: "/ecs/knowledge-base-etl",
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });


    // Create ECS Task Role
    const taskRole = new iam.Role(this, "ETLTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      maxSessionDuration: Duration.hours(12),
    });
    
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "es:ESHttpGet",
          "es:ESHttpPut",
          "es:ESHttpPost",
          "es:ESHttpHead",
          "bedrock:*",
          "secretsmanager:GetSecretValue",
        ],
        effect: iam.Effect.ALLOW,
        resources: ["*"],
      }),
    );
    taskRole.addToPolicy(this.iamHelper.endpointStatement);
    taskRole.addToPolicy(this.iamHelper.s3Statement);
    taskRole.addToPolicy(this.iamHelper.logStatement);
    taskRole.addToPolicy(this.dynamodbStatement);
    taskRole.addToPolicy(this.iamHelper.dynamodbStatement);
    taskRole.addToPolicy(this.iamHelper.secretsManagerStatement);

    // Create ECS Task Execution Role
    const executionRole = new iam.Role(this, "ETLExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
      ],
    });
    
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ],
        resources: ["*"],
      })
    );

    // Create Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, "ETLTaskDefinition", {
      memoryLimitMiB: 4096,
      cpu: 2048,
      taskRole: taskRole,
      executionRole: executionRole,
    });

    // Add container to task definition
    const container = taskDefinition.addContainer("ETLContainer", {
      image: ecs.ContainerImage.fromEcrRepository(repository, "latest"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "etl",
        logGroup: logGroup,
      }),
      environment: {
        AWS_REGION: deployRegion,
        ETL_MODEL_ENDPOINT: props.modelConstructOutputs.defaultKnowledgeBaseModelName,
        RES_BUCKET: this.glueResultBucket.bucketName,
        ETL_OBJECT_TABLE: this.etlObjTableName || "-",
        BEDROCK_REGION: props.config.chat.bedrockRegion || deployRegion,
        CHATBOT_ID: "default",
        INDEX_ID: "default",
        GROUP_NAME: "default",
      },
    });

    container.addPortMappings({
      containerPort: 8000,
      protocol: ecs.Protocol.TCP,
    });

    // Create ECS Service
    const service = new ecs.FargateService(this, "ETLService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: {
        subnets: props.sharedConstructOutputs.privateSubnets,
      },
      securityGroups: props.sharedConstructOutputs.securityGroups,
    });

    // Create Application Load Balancer
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "ETLLoadBalancer", {
      vpc: vpc,
      internetFacing: false,
      vpcSubnets: {
        subnets: props.sharedConstructOutputs.privateSubnets,
      },
      securityGroup: props.sharedConstructOutputs.securityGroups[0],
    });

    // Create Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "ETLTargetGroup", {
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      vpc: vpc,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
      },
    });

    // Add service to target group
    service.attachToApplicationTargetGroup(targetGroup);

    // Create Listener
    const listener = loadBalancer.addListener("ETLListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    return { service, loadBalancer };
  }
}