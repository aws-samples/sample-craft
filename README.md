<!-- English | [简体中文](README_zh-cn.md) -->

<div align="center">

# 🎨 <span style="color: #FF6B35">C</span><span style="color: #F7931E">R</span><span style="color: #FFD23F">A</span><span style="color: #06FFA5">F</span><span style="color: #118AB2">T</span>

### **Conversion, Recognition And Fragmentation Toolkit**

<h3>Intelligent Document Processing & Agent-Based Applications Platform</h3>

[![⭐ Stars](https://img.shields.io/github/stars/aws-samples/sample-craft.svg?style=for-the-badge&logo=github&color=FFD700)](https://github.com/aws-samples/sample-craft/stargazers)
[![🔧 Build](https://img.shields.io/github/actions/workflow/status/aws-samples/sample-craft/pull-request-lint.yml?style=for-the-badge&logo=github-actions)](https://github.com/aws-samples/sample-craft/actions/workflows/pull-request-lint.yml)
[![📄 License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=for-the-badge&logo=apache)](https://opensource.org/license/apache-2-0)

---

</div>

<div align="center">

## **Welcome to CRAFT**

*The ultimate toolkit for intelligent document transformation and AI-powered knowledge management*

</div>

### **What is CRAFT?**

CRAFT (Conversion, Recognition And Fragmentation Toolkit) is a cutting-edge platform that seamlessly combines intelligent document processing with agent-based conversational AI. Transform your documents into actionable knowledge with unprecedented ease and precision.

### **Key Features**

**Smart Document Conversion**
- Automatically converts 12+ formats (PDF, DOCX, Excel, CSV, HTML, etc.) to clean Markdown
- Intelligent image extraction and S3 storage integration
- Preserves document structure and formatting

**Comprehensive APIs**
- RESTful APIs for document conversion and chat functionality
- WebSocket support for real-time communication
- Easy integration with existing applications

<div align="center">

### **Deploy. Convert. Chat. Repeat.**

*CRAFT empowers developers to build intelligent, context-aware applications with minimal overhead and maximum efficiency.*

</div>

## **Table of Contents**

- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [FAQ](#faq)
- [Contribution](#contribution)
- [License](#license)


### **CRAFT Document Processing Pipeline**
CRAFT's intelligent processing engine provides comprehensive document transformation with format recognition, content extraction to Markdown, image extraction and storage, metadata conversion, and semantic segmentation, all operating seamlessly in the background.

![Offline Workflow](docs/images/intelli-agent-kb-etl.png)

When a large number of content injection requests are received, it can automatically scale out by running multiple Amazon Glue jobs concurrently, ensuring these requests are processed in time.

#### Chunk Metadata
Chunk metadata is defined as below shown:
| Name              | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| file_path         | S3 path to store the file                                                        |
| file_type         | File type, eg. pdf, html                                                         |
| content_type      | paragraph: paragraph content                                                     |
| current_heading   | The heading which the chunk belongs to                                           |
| chunk_id          | Unique chunk id                                                                  |
| heading_hierarchy | Heading hierarchy which is used to locate the chunk in the whole file content    |
| title             | The heading of current section                                                   |
| level             | Heading level, eg. H1 is #, H2 is ## in markdown                                 |
| parent            | The chunk id of parent section, eg. H2's parent is its H1, H3's parent is its H2 |
| previous          | The chunk id of previous paragraph at the same Level                             |
| child             | The chunk ids of sub sections                                                    |
| next              | The chunk id of next paragraph at the same Level                                 |
| size              | The number of the chunks when the paragraph is split by a fixed chunk size       |

Here is an example

```
{
	"file_path": "s3://example/intelli-agent-user-guide.pdf",
	"file_type": "pdf",
	"content_type": "paragragh",
	"current_heading": "# Intelli-Agent User Guide WebApp",
	"chunk_id": "$1-4659f607-1",
	"heading_hierarchy": {
		"title": "Intelli-Agent User Guide",
		"level": 1,
		"parent": null,
		"previous": null,
		"child": [
			"$2-038759db",
			"$4-68d6e6ca",
			"$6-e9cdcf68"
		],
		"next": null,
		"size": 2
	}
}

```



## **Quick Start**


### **Deployment**

To deploy the solution, follow these steps:

**Step 1**: Clone the GitHub repository

```bash
git clone <repo_url>
```

**Step 2**: Navigate to the deployment directory

```bash
cd deployment
```

**Step 3**: Run the installer script

```bash
# Deploy everything (config + build + deploy)
./installer.sh

# Or run individual steps:
./installer.sh config  # Install dependencies and configure
./installer.sh build   # Build and prepare assets
./installer.sh deploy  # Deploy to AWS
```


### **Updating an Existing Deployment**

You can update an existing deployment following these steps:

**Step 1**: Navigate to the deployment directory

```bash
cd deployment
```

**Step 2**: Adjust the configuration

Rerun `./installer.sh config`, or modify the config.json located under the `source/infrastructure/bin` directory.


**Step 3**: Update the deployment

```bash
# Update everything
./installer.sh

# Or update specific components:
./installer.sh build   # Rebuild assets only
./installer.sh deploy  # Deploy changes only
```


## **API Reference**
After CDK deployment, you can use HTTP clients to invoke the APIs.

### **RESTful API**
- **Endpoint**: `/process`
- **Method**: POST
- **Purpose**: Convert documents (PDF, DOCX, Excel, CSV, HTML) to Markdown with automatic image extraction
- **Input**: S3 bucket and object key of source document
- **Output**: Converted Markdown file location and extracted image locations in S3


## **FAQ**

### **Environment issues**

Follow below steps if you encounter an environment issue.

**Step 1**: Install the required dependencies

Execute following commands to install dependencies such as Python, Git, npm, docker and create a service linked role for Amazon OpenSearch service. You can skip this step if they are already installed.
The `setup_env.sh` script is adapted for Amazon Linux 2023. If you are using other operating systems, please manually install these dependencies.


```bash
wget https://raw.githubusercontent.com/aws-samples/sample-craft/refs/heads/main/source/script/setup_env.sh
sh setup_env.sh
```

**Step 2**: Install the AWS CLI 

Execute the following command to install the AWS CLI if it is not installed.

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

Execute the following command to check the AWS CLI version:

```bash
aws --version
```


## **Contribution**
We welcome contributions! See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## **License**
This project is licensed under the Apache-2.0 License.

---

<div align="center">

### 🎨 **Built with CRAFT** 🎨

*Transform your documents. Empower your knowledge. Accelerate your AI.*

**[⭐ Star us on GitHub](https://github.com/aws-samples/sample-craft) | [📖 Documentation]() | [🐛 Report Issues](https://github.com/aws-samples/sample-craft/issues)**

</div>
