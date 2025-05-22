const https = require('https');
const url = require('url');
const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require('@aws-sdk/client-cloudfront');
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');

exports.handler = async (event, context) => {
  let responseStatus = 'SUCCESS';
  let responseData = {};
  try {
    const cloudfront = new CloudFrontClient({});
    const cloudformation = new CloudFormationClient({});
    
    const rootStackName = process.env.ROOT_STACK_NAME;
    const distributionId = "E6SQ3O0W9TU5G";

    if (!rootStackName || !distributionId) {
      throw new Error('Missing environment variables ROOT_STACK_NAME or DISTRIBUTION_ID');
    }

    const stackRes = await cloudformation.send(new DescribeStacksCommand({ StackName: rootStackName }));
    const outputs = stackRes.Stacks[0].Outputs;
    const albEndpoint = outputs?.find(o => o.OutputKey === 'ALBEndpointAddress')?.OutputValue;

    if (!albEndpoint) {
      throw new Error('ALB endpoint not found in stack outputs');
    }

    const distributionRes = await cloudfront.send(new GetDistributionConfigCommand({ Id: distributionId }));
    const existingConfig = distributionRes.DistributionConfig;
    const etag = distributionRes.ETag;

    // Add ALB origin to existing origins
    const existingOrigins = Array.isArray(existingConfig.Origins.Items) 
      ? existingConfig.Origins.Items
      : [];
    
    const newOrigins = [
      ...existingOrigins,
      // Add ALB origin
      {
        Id: 'OriginForALB',
        DomainName: albEndpoint,
        OriginPath: '',
        CustomOriginConfig: {
          HTTPPort: 80,
          HTTPSPort: 443,
          OriginProtocolPolicy: 'http-only',
          OriginSslProtocols: {
            Quantity: 1,
            Items: ['TLSv1.2']
          },
          OriginKeepaliveTimeout: 60,
          OriginReadTimeout: 30
        },
        CustomHeaders: {
          Quantity: 0
        },
        ConnectionAttempts: 3,
        ConnectionTimeout: 10,
        OriginShield: { Enabled: false },
        OriginAccessControlId: ''
      }
    ];

    // Add cache behavior for ALB
    const newCacheBehaviors = [
      {
        PathPattern: '/stream*',
        TargetOriginId: 'OriginForALB',
        ViewerProtocolPolicy: 'https-only',
        AllowedMethods: {
          Quantity: 7,
          Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
          CachedMethods: {
            Quantity: 3,
            Items: ['GET', 'HEAD', 'OPTIONS']
          }
        },
        ForwardedValues: {
          QueryString: true,
          Cookies: { 
            Forward: 'all',
            WhitelistedNames: {
              Quantity: 0,
              Items: []
            }
          },
          Headers: {
            Quantity: 14,
            Items: [
              'Host',
              'Origin',
              'Authorization',
              'Oidc-Info',
              'Content-Type',
              'Accept',
              'Accept-Encoding',
              'Accept-Language',
              'Referer',
              'User-Agent',
              'X-Forwarded-For',
              'X-Forwarded-Proto',
              'X-Requested-With',
              'Cache-Control'
            ]
          },
          QueryStringCacheKeys: {
            Quantity: 0,
            Items: []
          }
        },
        MinTTL: 0,
        DefaultTTL: 0,
        MaxTTL: 0,
        SmoothStreaming: false,
        Compress: true,
        FieldLevelEncryptionId: '',
        TrustedSigners: {
          Enabled: false,
          Quantity: 0,
          Items: []
        },
        TrustedKeyGroups: {
          Enabled: false,
          Quantity: 0,
          Items: []
        },
        LambdaFunctionAssociations: {
          Quantity: 0,
          Items: []
        },
        FunctionAssociations: {
          Quantity: 0,
          Items: []
        }
      }
    ];

    const finalConfig = {
      ...existingConfig,
      Origins: {
        Quantity: newOrigins.length,
        Items: newOrigins
      },
      DefaultCacheBehavior: existingConfig.DefaultCacheBehavior,
      CacheBehaviors: {
        Quantity: newCacheBehaviors.length,
        Items: newCacheBehaviors
      }
    };

    await cloudfront.send(new UpdateDistributionCommand({
      Id: distributionId,
      IfMatch: etag,
      DistributionConfig: finalConfig
    }));

    responseStatus = 'SUCCESS';
    responseData = { Message: 'CloudFront distribution updated successfully' };
  } catch (err) {
    console.error('Update failed:', err);
    responseStatus = 'FAILED';
    responseData = { Error: err.message };
  }

  // 检查是否有 ResponseURL
  if (!event.ResponseURL) {
    console.log('No ResponseURL found, returning result directly');
    return {
      statusCode: responseStatus === 'SUCCESS' ? 200 : 500,
      body: JSON.stringify(responseData)
    };
  }

  await sendCloudFormationResponse(event, context, responseStatus, responseData, 'UpdateCloudFront');
};

async function sendCloudFormationResponse(event, context, responseStatus, responseData, physicalResourceId) {
  if (!event.ResponseURL) {
    console.error('ResponseURL is undefined');
    return;
  }

  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: responseStatus === 'FAILED' ? responseData.Error || 'Error' : 'See CloudWatch Log Stream: ' + context.logStreamName,
    PhysicalResourceId: physicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: responseData
  });

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': Buffer.byteLength(responseBody)
    }
  };

  await new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      resolve();
    });
    request.on('error', (error) => {
      reject(error);
    });
    request.write(responseBody);
    request.end();
  });
}