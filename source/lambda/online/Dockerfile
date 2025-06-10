FROM python:3.12-slim


# Install system dependencies
RUN apt-get update && \
    apt-get install -y curl nodejs npm && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install pipx
RUN python -m pip install --user pipx && \
    python -m pipx ensurepath

# Install uvx using pipx
# RUN /root/.local/bin/pipx install uvx

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install -r requirements.txt

# Copy shared code first
COPY shared /app/shared/

# Copy function code
COPY . /app/

# Expose port 80
EXPOSE 80

# Set the working directory
WORKDIR /app

# Add local bin to PATH
ENV PATH="/root/.local/bin:${PATH}"

# Set the CMD to run the FastAPI app
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "80"]
