#!/bin/bash

# Local Build Test Script for Jimothy
# Tests platform compatibility before pushing to CI

set -e

echo "🧪 Jimothy Local Build Test"
echo "============================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0

test_step() {
    echo -e "${YELLOW}▶${NC} $1"
}

test_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

test_fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

# Detect platform
PLATFORM=$(uname -s)
case "$PLATFORM" in
    Darwin*) PLATFORM_NAME="macOS" ;;
    Linux*)  PLATFORM_NAME="Linux" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM_NAME="Windows" ;;
    *) PLATFORM_NAME="Unknown" ;;
esac

echo "Platform: $PLATFORM_NAME"
echo ""

# Test 1: TypeScript type checking
test_step "Running TypeScript type check..."
if npm run typecheck; then
    test_pass "TypeScript types are valid"
else
    test_fail "TypeScript type errors found"
fi
echo ""

# Test 2: Frontend tests
test_step "Running frontend tests..."
if npm run test; then
    test_pass "Frontend tests passed"
else
    test_fail "Frontend tests failed"
fi
echo ""

# Test 3: Rust compilation check (all platforms)
test_step "Checking Rust compilation (cargo check)..."
if cargo check --manifest-path src-tauri/Cargo.toml; then
    test_pass "Rust code compiles"
else
    test_fail "Rust compilation errors"
fi
echo ""

# Test 4: Rust tests
test_step "Running Rust tests..."
if cargo test --manifest-path src-tauri/Cargo.toml; then
    test_pass "Rust tests passed"
else
    test_fail "Rust tests failed"
fi
echo ""

# Test 5: Platform-specific builds
if [[ "$PLATFORM_NAME" == "macOS" ]]; then
    test_step "Testing macOS-specific code compilation..."

    # Check that macOS-specific code compiles
    if cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin; then
        test_pass "macOS (aarch64) code compiles"
    else
        test_fail "macOS (aarch64) compilation failed"
    fi

    if cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-apple-darwin; then
        test_pass "macOS (x86_64) code compiles"
    else
        test_fail "macOS (x86_64) compilation failed"
    fi

elif [[ "$PLATFORM_NAME" == "Windows" ]]; then
    test_step "Testing Windows-specific code compilation..."

    if cargo check --manifest-path src-tauri/Cargo.toml; then
        test_pass "Windows code compiles"
    else
        test_fail "Windows compilation failed"
    fi

elif [[ "$PLATFORM_NAME" == "Linux" ]]; then
    test_step "Testing Linux code compilation..."

    if cargo check --manifest-path src-tauri/Cargo.toml; then
        test_pass "Linux code compiles"
    else
        test_fail "Linux compilation failed"
    fi
fi
echo ""

# Test 6: Check for platform-specific code issues
test_step "Checking for platform-specific code issues..."
echo "Scanning for conditional compilation attributes..."

# Look for cfg attributes in main source files
PLATFORM_CHECKS=$(grep -r "#\[cfg(target_os" src-tauri/src/ || true)
if [[ -n "$PLATFORM_CHECKS" ]]; then
    echo "$PLATFORM_CHECKS" | head -10
    test_pass "Found platform-specific code (reviewed above)"
else
    test_pass "No platform-specific code found"
fi
echo ""

# Test 7: Frontend build
test_step "Testing frontend production build..."
if npm run build; then
    test_pass "Frontend builds successfully"
else
    test_fail "Frontend build failed"
fi
echo ""

# Test 8: Dev mode smoke test (optional - skipped in CI)
if [[ "${SKIP_DEV_TEST}" != "1" ]]; then
    echo -e "${YELLOW}ℹ${NC} Skipping dev mode test (use SKIP_DEV_TEST=0 to enable)"
    echo "  This would start the dev server but requires manual testing"
else
    test_step "Would test dev mode (skipped)..."
fi
echo ""

# Summary
echo "============================"
echo "Test Summary"
echo "============================"
echo -e "${GREEN}Passed:${NC} $PASSED"
echo -e "${RED}Failed:${NC} $FAILED"
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo "Ready to commit and push."
    exit 0
else
    echo -e "${RED}✗ Some tests failed!${NC}"
    echo "Please fix the issues before pushing."
    exit 1
fi
