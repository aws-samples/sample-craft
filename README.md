<!-- English | [简体中文](README_zh-cn.md) -->

<div align="center">

<img src="docs/image/logo.png" alt="CRAFT Logo" width="300">

### **C**onversion, **R**ecognition **A**nd **F**ragmentation **T**oolkit

</div>

### **What is CRAFT?**

CRAFT (Conversion, Recognition And Fragmentation Toolkit) is a document processing solution that streamlines the transformation of complex documents. It efficiently converts documents into markdown format, leverages advanced image recognition capabilities, and implements text fragmentation to generate optimized content chunks for enhanced processing and analysis.

### **Key Features**

- Native support for 10+ document formats with seamless conversion to clean Markdown
- Advanced image recognition with intelligent content fragmentation
- Scalable S3 storage and MCP protocol integration


## **Get Started**

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

After deployment, it automatically provisions an MCP server accessible through the AgentCore Gateway.


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

### Chunk Metadata
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


---

<div align="center">

### **Built with CRAFT**

*Streamline document processing. Enhance knowledge extraction. Optimize AI workflows.*

**[Star us on GitHub](https://github.com/aws-samples/sample-craft) | [Report Issues](https://github.com/aws-samples/sample-craft/issues)**

</div>
