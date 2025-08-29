#!/bin/bash

set -e

case "${1:-all}" in
    config)
        echo "Running config step..."
        cd ../source/infrastructure && npm install && npm run config && cd ../../deployment
        ;;
    build)
        echo "Running build step..."
        cd ../source/infrastructure && npm run build && cd ../../deployment
        ;;
    deploy)
        echo "Running deploy step..."
        sh deploy.sh
        ;;
    all|*)
        echo "Running all steps..."
        cd ../source/infrastructure 
        npm install && npm run config
        npm run build
        cd ../../deployment
        sh deploy.sh
        ;;
esac

echo "Installer completed"