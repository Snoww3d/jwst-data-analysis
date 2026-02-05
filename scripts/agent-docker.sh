#!/usr/bin/env bash
# Agent Docker stack manager
# Usage: ./scripts/agent-docker.sh <command> <agent-number>
#
# Commands:
#   up      - Start the agent's Docker stack (builds images)
#   down    - Stop the agent's Docker stack
#   restart - Restart the agent's Docker stack
#   logs    - Tail logs for the agent's stack
#   ps      - Show running containers for the agent
#   exec    - Execute a command in a container (e.g., exec 1 processing pytest)
#
# Examples:
#   ./scripts/agent-docker.sh up 1        # Start Agent 1's stack
#   ./scripts/agent-docker.sh down 2      # Stop Agent 2's stack
#   ./scripts/agent-docker.sh logs 1      # Tail Agent 1's logs
#   ./scripts/agent-docker.sh exec 1 processing python -m pytest

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"

usage() {
    echo "Usage: $0 <command> <agent-number> [args...]"
    echo ""
    echo "Commands: up, down, restart, logs, ps, exec"
    echo "Agent numbers: 1, 2"
    echo ""
    echo "Examples:"
    echo "  $0 up 1              # Start Agent 1's stack"
    echo "  $0 down 2            # Stop Agent 2's stack"
    echo "  $0 exec 1 processing python -m pytest"
    exit 1
}

if [[ $# -lt 2 ]]; then
    usage
fi

COMMAND="$1"
AGENT_NUM="$2"
shift 2

if [[ "$AGENT_NUM" != "1" && "$AGENT_NUM" != "2" ]]; then
    echo "Error: Agent number must be 1 or 2"
    exit 1
fi

PROJECT_NAME="jwst-agent${AGENT_NUM}"
ENV_FILE="$DOCKER_DIR/.env.agent${AGENT_NUM}"
COMPOSE_FILES="-f $DOCKER_DIR/docker-compose.yml -f $DOCKER_DIR/docker-compose.agent.yml"

# Bootstrap .env file if it doesn't exist
if [[ ! -f "$ENV_FILE" ]]; then
    echo "Agent ${AGENT_NUM} .env file not found. Generating..."
    "$SCRIPT_DIR/agent-env-init.sh" "$AGENT_NUM"
fi

compose() {
    docker compose -p "$PROJECT_NAME" $COMPOSE_FILES --env-file "$ENV_FILE" "$@"
}

case "$COMMAND" in
    up)
        echo "Starting Agent ${AGENT_NUM} Docker stack..."
        compose up -d --build "$@"
        echo "Agent ${AGENT_NUM} stack is running."
        compose ps
        ;;
    down)
        echo "Stopping Agent ${AGENT_NUM} Docker stack..."
        compose down "$@"
        ;;
    restart)
        echo "Restarting Agent ${AGENT_NUM} Docker stack..."
        compose down
        compose up -d --build "$@"
        compose ps
        ;;
    logs)
        compose logs -f "$@"
        ;;
    ps)
        compose ps "$@"
        ;;
    exec)
        if [[ $# -lt 1 ]]; then
            echo "Usage: $0 exec <agent> <service> <command...>"
            echo "Services: backend, processing-engine, frontend, mongodb"
            exit 1
        fi
        SERVICE="$1"
        shift
        CONTAINER_PREFIX="jwst-a${AGENT_NUM}"
        case "$SERVICE" in
            backend|processing|processing-engine|frontend|mongodb)
                SERVICE_SHORT="${SERVICE/processing-engine/processing}"
                compose exec "$SERVICE_SHORT" "$@"
                ;;
            *)
                echo "Unknown service: $SERVICE"
                echo "Available: backend, processing-engine, frontend, mongodb"
                exit 1
                ;;
        esac
        ;;
    *)
        echo "Unknown command: $COMMAND"
        usage
        ;;
esac
