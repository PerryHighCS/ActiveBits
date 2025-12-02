#!/bin/bash
set -e

echo "🔧 Setting up ActiveBits development environment..."

# Wait for Valkey to be ready
echo "⏳ Waiting for Valkey to be ready..."
until redis-cli -h valkey ping 2>/dev/null | grep -q PONG; do
  echo "Valkey is unavailable - sleeping"
  sleep 1
done
echo "✅ Valkey is ready!"

# Test connection
echo "🧪 Testing Valkey connection..."
redis-cli -h valkey ping

echo "✨ Development environment is ready!"
echo ""
echo "Environment variables:"
echo "  VALKEY_URL=$VALKEY_URL"
echo ""
echo "To test Valkey manually, run:"
echo "  redis-cli -h valkey"
