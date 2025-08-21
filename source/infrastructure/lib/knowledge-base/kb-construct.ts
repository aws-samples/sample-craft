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

import { Duration, StackProps, RemovalPolicy, Aws, CfnOutput } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
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
  readonly enableHttps?: boolean;
}

export interface KnowledgeBaseStackOutputs {
  readonly ecsService: ecs.FargateService;
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly executionTableName: string;
  readonly etlObjTableName: string;
  readonly etlObjIndexName: string;
  readonly agentCoreGatewayLambda: lambda.Function;
}

export class KnowledgeBaseStack extends Construct implements KnowledgeBaseStackOutputs {
  public etlObjIndexName: string = "ExecutionIdIndex";
  public executionTableName: string = "";
  public etlObjTableName: string = "";
  public ecsService: ecs.FargateService;
  public loadBalancer: elbv2.ApplicationLoadBalancer;
  public agentCoreGatewayLambda: lambda.Function;
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

    const { ecsService, loadBalancer, apiKeySecret } = this.createECSFargateService(props);
    this.ecsService = ecsService;
    this.loadBalancer = loadBalancer;
    
    // Create Cognito resources
    this.createCognitoResources();
    
    // Create AgentCore Gateway IAM role
    this.createAgentCoreGatewayRole();
    
    // Create AgentCore Gateway Lambda
    this.agentCoreGatewayLambda = this.createAgentCoreGateway(apiKeySecret);

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
  
  private createECSFargateService(props: any): { ecsService: ecs.FargateService; loadBalancer: elbv2.ApplicationLoadBalancer; apiKeySecret: secretsmanager.Secret } {
    const deployRegion = props.config.deployRegion;

    // Generate API key and store in Secrets Manager
    const apiKeySecret = new secretsmanager.Secret(this, "ETLAPIKeySecret", {
      description: "API key for ETL service authentication",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "etl-service" }),
        generateStringKey: "api_key",
        excludeCharacters: " %+~`#$&*()|[]{}:;<>?!'/@\"\\\n\r\t",
        passwordLength: 32,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create VPC
    const vpc = new ec2.Vpc(this, "ETLVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, "ETLCluster", {
      vpc: vpc,
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
    
    // Add necessary policies
    taskRole.addToPolicy(this.iamHelper.endpointStatement);
    taskRole.addToPolicy(this.iamHelper.s3Statement);
    taskRole.addToPolicy(this.iamHelper.logStatement);
    taskRole.addToPolicy(this.dynamodbStatement);
    taskRole.addToPolicy(this.iamHelper.dynamodbStatement);
    taskRole.addToPolicy(this.iamHelper.secretsManagerStatement);

    // Create ECS Task Execution Role
    const executionRole = new iam.Role(this, "ETLExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    
    executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")
    );

    // Create Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, "ETLTaskDefinition", {
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole: taskRole,
      executionRole: executionRole,
    });

    // Add container to task definition
    const container = taskDefinition.addContainer("ETLContainer", {
      image: ecs.ContainerImage.fromAsset("../lambda/job"),
      environment: {
        DEPLOY_REGION: deployRegion,
        ETL_MODEL_ENDPOINT: props.modelConstructOutputs.defaultKnowledgeBaseModelName,
        RES_BUCKET: this.glueResultBucket.bucketName,
        ETL_OBJECT_TABLE: this.etlObjTableName || "-",
        BEDROCK_REGION: deployRegion,
        API_KEY_SECRET_ARN: apiKeySecret.secretArn,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "etl",
        logGroup: logGroup,
      }),
    });

    // Grant the task role permission to read the API key secret
    apiKeySecret.grantRead(taskRole);

    container.addPortMappings({
      containerPort: 8080,
      protocol: ecs.Protocol.TCP,
    });

    // Create Fargate Service
    const service = new ecs.FargateService(this, "ETLService", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
    });

    // Create Application Load Balancer
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "ETLLoadBalancer", {
      vpc: vpc,
      internetFacing: true,
    });

    // Create Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "ETLTargetGroup", {
      port: 8080,
      vpc: vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200",
      },
    });

    // Add targets to target group first
    service.attachToApplicationTargetGroup(targetGroup);

    // Create HTTP Listener with target group
    loadBalancer.addListener("ETLHTTPListener", {
      port: 80,
      defaultTargetGroups: [targetGroup],
    });



    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, "ETLDistribution", {
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 80,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
    });

    // Output CloudFront URL for setup script
    new CfnOutput(this, "CloudFrontURL", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CloudFront HTTPS URL (use in setup-https-and-gateway.sh)"
    });

    return { ecsService: service, loadBalancer: loadBalancer, apiKeySecret: apiKeySecret };
  }

  private createCognitoResources() {
    // Create Cognito User Pool
    this.cognitoUserPool = new cognito.UserPool(this, "CraftPool", {
      // userPoolName: "etl-${Aws.ACCOUNT_ID}",
      passwordPolicy: {
        minLength: 8,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create Resource Server
    const resourceServer = this.cognitoUserPool.addResourceServer("ETLResourceServer", {
      identifier: "etl-gateway-id",
      // userPoolResourceServerName: "sample-agentcore-gateway-name",
      scopes: [
        { scopeName: "genesis-gateway:invoke", scopeDescription: "Scope for invoking the genesis gateway" },
      ],
    });

    // Add domain for Hosted UI (classic)
    const userPoolDomain = this.cognitoUserPool.addDomain("ETLUserDomain", {
      cognitoDomain: {
        domainPrefix: `etl-${Aws.ACCOUNT_ID}`,
      },
    });

    // Create App Client with updated authentication flows
    this.cognitoClient = this.cognitoUserPool.addClient("ETLClient", {
      // userPoolClientName: "etl-${Aws.ACCOUNT_ID}",
      generateSecret: true,
      oAuth: {
        flows: {
          clientCredentials: true,
        },
        scopes: [
          cognito.OAuthScope.resourceServer(resourceServer, { scopeName: "genesis-gateway:invoke", scopeDescription: "Scope for invoking the genesis gateway" }),
        ],
      },
      authFlows: {
        userSrp: true,
        custom: true,
        userPassword: false,
        adminUserPassword: false,
      },
      refreshTokenValidity: Duration.days(30),
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
                "secretsmanager:GetSecretValue"
              ],
              resources: ["*"]
            })
          ]
        })
      }
    });
  }

  private createAgentCoreGateway(apiKeySecret: secretsmanager.Secret): lambda.Function {
    // Create S3 bucket for OpenAPI spec
    const apiBucket = new s3.Bucket(this, "APIBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Upload original OpenAPI spec first
    new s3deploy.BucketDeployment(this, "APIDeployment", {
      sources: [s3deploy.Source.asset("api")],
      destinationBucket: apiBucket,
    });

    // Create Lambda function for AgentCore Gateway management
    const agentCoreGatewayLambda = new lambda.Function(this, "AgentCoreGatewayLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "gateway_manager.handler",
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
        COGNITO_USER_POOL_ID: this.cognitoUserPool.userPoolId,
        COGNITO_CLIENT_ID: this.cognitoClient.userPoolClientId,
        AGENTCORE_ROLE_ARN: this.agentCoreGatewayRole.roleArn,
        OPENAPI_FILE_ARN: `s3://${apiBucket.bucketName}/openapi.json`,
        API_KEY_SECRET_ARN: apiKeySecret.secretArn
      }
    });
    
    agentCoreGatewayLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:*",
          "iam:PassRole",
          "iam:GetRole",
          "iam:ListRoles",
          "cognito-idp:*",
          "logs:*",
          "s3:GetObject",
          "secretsmanager:GetSecretValue",
          "secretsmanager:CreateSecret"
        ],
        resources: ["*"]
      })
    );
    
    // Grant S3 read access to the Lambda
    apiBucket.grantRead(agentCoreGatewayLambda);
    
    // Grant permission to read the API key secret
    apiKeySecret.grantRead(agentCoreGatewayLambda);
    
    // Grant permission to pass the AgentCore gateway role
    this.agentCoreGatewayRole.grantPassRole(agentCoreGatewayLambda.role!);

    // Output S3 bucket name and Lambda function name for setup script
    new CfnOutput(this, "APIBucketName", {
      value: apiBucket.bucketName,
      description: "S3 bucket name for OpenAPI spec (use in setup-https-and-gateway.sh)"
    });

    new CfnOutput(this, "AgentCoreGatewayLambdaName", {
      value: agentCoreGatewayLambda.functionName,
      description: "Lambda function name for AgentCore Gateway (use in setup-https-and-gateway.sh)"
    });

    return agentCoreGatewayLambda;
  }
}