FROM python:3.12-slim

# Install system dependencies for lxml and other packages
RUN apt-get update && \
    apt-get install -y libxml2-dev libxslt-dev gcc python3-dev curl && \
    apt-get clean

# Install AWS Lambda Runtime Interface Client
RUN pip install --no-cache-dir wheel setuptools awslambdaric

# Set Python path to include the current directory
ENV PYTHONPATH="${PYTHONPATH}:/var/task"

# Create directory for Lambda function
WORKDIR /var/task

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy function code
COPY . .

# Create entrypoint script
RUN echo '#!/bin/bash\n\nif [ -z "${AWS_LAMBDA_RUNTIME_API}" ]; then\n  exec aws-lambda-ric "$@"\nelse\n  exec "$@"\nfi' > /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh

# Set the entrypoint
ENTRYPOINT ["python", "-m", "awslambdaric"]

# Set the handler
CMD ["main.lambda_handler"]