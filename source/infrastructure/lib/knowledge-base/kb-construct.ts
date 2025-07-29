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

import { Duration, StackProps, RemovalPolicy, CustomResource, Aws } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import { Architecture } from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cr from "aws-cdk-lib/custom-resources";
import * as cognito from "aws-cdk-lib/aws-cognito";
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
  readonly executionTableName: string;
  readonly etlObjTableName: string;
  readonly etlObjIndexName: string;
}

export class KnowledgeBaseStack extends Construct implements KnowledgeBaseStackOutputs {
  public etlObjIndexName: string = "ExecutionIdIndex";
  public executionTableName: string = "";
  public etlObjTableName: string = "";
  public lambdaFunction: DockerImageFunction;
  private iamHelper: IAMHelper;
  private glueResultBucket: s3.Bucket;
  private dynamodbStatement: iam.PolicyStatement;
  private agentCoreGatewayRole!: iam.Role;
  private cognitoUserPool!: cognito.UserPool;
  private cognitoClient!: cognito.UserPoolClient;


  constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
    super(scope, id);

    this.iamHelper = props.sharedConstructOutputs.iamHelper;
    this.glueResultBucket = props.sharedConstructOutputs.resultBucket;


    const createKnowledgeBaseTablesAndPoliciesResult = this.createKnowledgeBaseTablesAndPolicies();
    this.executionTableName = createKnowledgeBaseTablesAndPoliciesResult.executionTable.tableName;
    this.etlObjTableName = createKnowledgeBaseTablesAndPoliciesResult.etlObjTable.tableName;
    this.dynamodbStatement = createKnowledgeBaseTablesAndPoliciesResult.dynamodbStatement;

    this.lambdaFunction = this.createKnowledgeBaseLambda(props);
    
    // Create Cognito resources
    this.createCognitoResources();
    
    // Create AgentCore Gateway IAM role
    this.createAgentCoreGatewayRole();
    
    // Create AgentCore Gateway
    this.createAgentCoreGateway(this.lambdaFunction);

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

  private createCognitoResources() {
    // Create Cognito User Pool
    this.cognitoUserPool = new cognito.UserPool(this, "AgentCoreUserPool", {
      userPoolName: "sample-agentcore-gateway-pool",
      passwordPolicy: {
        minLength: 8,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create Resource Server
    const resourceServer = this.cognitoUserPool.addResourceServer("AgentCoreResourceServer", {
      identifier: "sample-agentcore-gateway-id",
      // userPoolResourceServerName: "sample-agentcore-gateway-name",
      scopes: [
        { scopeName: "gateway:read", scopeDescription: "Read access" },
        { scopeName: "gateway:write", scopeDescription: "Write access" },
      ],
    });

    // Create App Client for machine-to-machine authentication
    this.cognitoClient = this.cognitoUserPool.addClient("AgentCoreClient", {
      userPoolClientName: "sample-agentcore-gateway-client",
      generateSecret: true,
      oAuth: {
        flows: {
          clientCredentials: true,
        },
        scopes: [
          cognito.OAuthScope.resourceServer(resourceServer, { scopeName: "gateway:read", scopeDescription: "Read access" }),
          cognito.OAuthScope.resourceServer(resourceServer, { scopeName: "gateway:write", scopeDescription: "Write access" }),
        ],
      },
      authFlows: {
        userPassword: false,
        userSrp: false,
        custom: false,
        adminUserPassword: false,
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });
  }

  private createAgentCoreGatewayRole() {
    this.agentCoreGatewayRole = new iam.Role(this, "AgentCoreGatewayRole", {
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com").withConditions({
        StringEquals: {
          "aws:SourceAccount": Aws.ACCOUNT_ID
        },
        ArnLike: {
          "aws:SourceArn": `arn:aws:bedrock-agentcore:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`
        }
      }),
      inlinePolicies: {
        AgentCoreGatewayPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock-agentcore:*",
                "bedrock:*",
                "agent-credential-provider:*",
                "iam:PassRole",
                "secretsmanager:GetSecretValue",
                "lambda:InvokeFunction"
              ],
              resources: ["*"]
            })
          ]
        })
      }
    });
  }

  private createAgentCoreGateway(lambdaFunction: DockerImageFunction) {
    // Create custom resource Lambda for AgentCore Gateway management
    const agentCoreCustomResourceLambda = new lambda.Function(this, "AgentCoreCustomResource", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "custom_resource.handler",
      timeout: Duration.minutes(10),
      code: lambda.Code.fromAsset("../lambda/agentcore_gateway", {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            "bash", "-c",
            "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output"
          ],
        },
      }),
      environment: {
        TARGET_LAMBDA_ARN: lambdaFunction.functionArn,
        COGNITO_USER_POOL_ID: this.cognitoUserPool.userPoolId,
        COGNITO_CLIENT_ID: this.cognitoClient.userPoolClientId,
        AGENTCORE_ROLE_ARN: this.agentCoreGatewayRole.roleArn
      }
    });
    
    agentCoreCustomResourceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:*",
          "lambda:InvokeFunction",
          "iam:PassRole",
          "iam:GetRole",
          "iam:ListRoles",
          "cognito-idp:*",
          "logs:*"
        ],
        resources: ["*"]
      })
    );
    
    // Grant permission to pass the AgentCore gateway role
    this.agentCoreGatewayRole.grantPassRole(agentCoreCustomResourceLambda.role!);

    // Create custom resource provider
    const provider = new cr.Provider(this, "AgentCoreProvider", {
      onEventHandler: agentCoreCustomResourceLambda,
    });
    
    // Ensure the custom resource depends on the gateway role
    provider.node.addDependency(this.agentCoreGatewayRole);

    // Create the custom resource
    const agentCoreGateway = new CustomResource(this, "AgentCoreGateway", {
      serviceToken: provider.serviceToken,
      properties: {
        GatewayName: "etl-mcp-gateway",
        Description: "AgentCore Gateway for ETL MCP tools",
        LambdaFunctionArn: lambdaFunction.functionArn
      }
    });

    return agentCoreGateway;
  }
}