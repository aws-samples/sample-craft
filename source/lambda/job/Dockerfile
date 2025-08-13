FROM python:3.12-slim

# Install system dependencies for lxml and other packages
RUN apt-get update && \
    apt-get install -y libxml2-dev libxslt-dev gcc python3-dev curl && \
    apt-get clean

# Install web server dependencies
RUN pip install --no-cache-dir wheel setuptools fastapi uvicorn

# Set Python path to include the current directory
ENV PYTHONPATH="${PYTHONPATH}:/app"

# Create directory for application
WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy function code
COPY . .

# Expose port
EXPOSE 8080

# Create web server wrapper
COPY web_server.py .

# Set the entrypoint for ECS
CMD ["uvicorn", "web_server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]