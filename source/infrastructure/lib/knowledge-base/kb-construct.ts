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

import { Duration, StackProps, RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import { Architecture } from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import { DynamoDBTable } from "../shared/table";

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
  readonly lambdaFunction: DockerImageFunction;
  readonly apiGateway: apigateway.RestApi;
  readonly apiKey: apigateway.ApiKey;
  readonly executionTableName: string;
  readonly etlObjTableName: string;
  readonly etlObjIndexName: string;
}

export class KnowledgeBaseStack extends Construct implements KnowledgeBaseStackOutputs {
  public etlObjIndexName: string = "ExecutionIdIndex";
  public executionTableName: string = "";
  public etlObjTableName: string = "";
  public lambdaFunction: DockerImageFunction;
  public apiGateway: apigateway.RestApi;
  public apiKey: apigateway.ApiKey;

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

    this.lambdaFunction = this.createKnowledgeBaseLambda(props);
    
    // Create API Gateway and API Key
    const { api, apiKey } = this.createApiGateway(this.lambdaFunction);
    this.apiGateway = api;
    this.apiKey = apiKey;

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


  private createApiGateway(lambdaFunction: DockerImageFunction) {
    // Create REST API
    const api = new apigateway.RestApi(this, "ETLApi", {
      restApiName: "Knowledge Base ETL API",
      description: "API for Knowledge Base ETL operations",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });
    
    // Create API usage plan
    const usagePlan = api.addUsagePlan("ETLUsagePlan", {
      name: "ETL API Usage Plan",
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
      quota: {
        limit: 1000,
        period: apigateway.Period.DAY,
      },
    });
    
    // Create API key
    const apiKey = new apigateway.ApiKey(this, "ETLApiKey", {
      apiKeyName: "etl-api-key",
      description: "API Key for ETL API",
      enabled: true,
    });
    
    // Add API key to usage plan
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });
    
    // Create Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction, {
      proxy: true,
    });
    
    // Create API resources and methods
    const etlResource = api.root.addResource("etl");
    
    // POST /etl - Process ETL job
    etlResource.addMethod("POST", lambdaIntegration, {
      apiKeyRequired: true,
    });
    
    // GET /etl - Get ETL status
    etlResource.addMethod("GET", lambdaIntegration, {
      apiKeyRequired: true,
    });
    
    return { api, apiKey };
  }
  
  private createKnowledgeBaseLambda(props: any): DockerImageFunction {
    const deployRegion = props.config.deployRegion;

    // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, "ETLLogGroup", {
      logGroupName: "/aws/lambda/knowledge-base-etl",
      removalPolicy: RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Lambda Role
    const lambdaRole = new iam.Role(this, "ETLLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    
    lambdaRole.addToPrincipalPolicy(
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
    
    // Add necessary policies
    lambdaRole.addToPolicy(this.iamHelper.endpointStatement);
    lambdaRole.addToPolicy(this.iamHelper.s3Statement);
    lambdaRole.addToPolicy(this.iamHelper.logStatement);
    lambdaRole.addToPolicy(this.dynamodbStatement);
    lambdaRole.addToPolicy(this.iamHelper.dynamodbStatement);
    lambdaRole.addToPolicy(this.iamHelper.secretsManagerStatement);
    
    // Add Lambda basic execution role
    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
    );

    // Create Lambda Function using Docker container
    const lambdaFunction = new DockerImageFunction(this, "ETLLambdaFunction", {
      code: DockerImageCode.fromImageAsset("../lambda/job"),
      architecture: Architecture.X86_64,
      role: lambdaRole,
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        DEPLOY_REGION: deployRegion,
        ETL_MODEL_ENDPOINT: props.modelConstructOutputs.defaultKnowledgeBaseModelName,
        RES_BUCKET: this.glueResultBucket.bucketName,
        ETL_OBJECT_TABLE: this.etlObjTableName || "-",
        BEDROCK_REGION: deployRegion,
      },
      logGroup: logGroup,
    });

    return lambdaFunction;
  }
}