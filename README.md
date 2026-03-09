Hybrid Memory Engine

Hybrid Memory Engine is an experimental long-term memory architecture for AI agents and large language models.
The system combines vector search, knowledge graphs, lifecycle scoring, and multi-stage retrieval to enable AI systems to maintain persistent and evolving memory.

Traditional RAG systems store information as static vectors. Hybrid Memory Engine explores a more structured approach where memory evolves over time through lifecycle management, relationship linking, and consolidation.

The goal is to improve how AI systems recall context, maintain facts, and connect related information across long time periods.

⸻

Problem

Current AI systems struggle with long-term memory.

Most implementations rely only on vector similarity search. While this works for semantic retrieval, it introduces several limitations.

AI forgets earlier interactions
Important facts may be lost over time
Outdated information may still be retrieved
Relationships between memories are not captured
Memory systems lack lifecycle evolution

These limitations make it difficult for AI agents to maintain persistent knowledge about users, environments, or tasks.

⸻

Solution

Hybrid Memory Engine introduces a hybrid memory architecture.

Instead of storing memories as static vectors, the system organizes memory across multiple layers.

Vector similarity for semantic retrieval
Graph relationships for linking related memories
Lifecycle scoring to track importance and decay
Consolidation pipelines to convert repeated events into facts
Multi-stage retrieval to improve ranking and speed

This architecture allows AI systems to maintain structured long-term memory.

⸻

Architecture Overview

User or AI Agent Interaction

↓

API Gateway

↓

Memory Service

↓

Storage Layer

Postgres with pgvector — vector memory
Redis — caching and working memory
Neo4j — relationship graph

↓

Processing Workers

Embedding worker
Graph linking worker
Lifecycle worker
Consolidation worker

↓

Retrieval Orchestrator

↓

Final context returned to the AI model

⸻

Key Features

Hybrid memory combining vectors and graph relationships
Memory lifecycle scoring and decay
Fact consolidation from repeated interactions
Truth revision to update outdated knowledge
Multi-stage retrieval pipeline
Scalable architecture for AI agent systems

⸻

Repository Structure

apps
Core services including API gateway and memory service

packages
Shared modules and reusable logic

storage
Database schemas and configurations

scripts
Development and startup scripts

observability
Logging, metrics, and tracing utilities

⸻

Running the System

This section explains how to run Hybrid Memory Engine locally.

Requirements

Node.js version 18 or later
Docker and Docker Compose
Git
pnpm or npm

The system uses Docker containers to run database services.

⸻

Clone the Repository

Open a terminal and run

git clone https://github.com/lucifer197/Hybrid-memory-engine.git

Move into the project directory

cd Hybrid-memory-engine

⸻

Install Dependencies

Install the required packages.

Using pnpm

pnpm install

Using npm

npm install

⸻

Start Infrastructure Services

The system requires several backend services.

Postgres with pgvector
Redis
Neo4j

Start these services with Docker

docker compose up -d

This will launch all infrastructure containers locally.

⸻

Start the API Service

Run the application server.

pnpm run dev

or

npm run dev

The API will start at

http://localhost:3000

⸻

Test Memory Write

Send a memory write request.

POST
http://localhost:3000/v1/memory/write

Example request body

{
“tenant_id”: “demo”,
“workspace_id”: “main”,
“user_id”: “user1”,
“content”: “My favorite programming language is Rust”
}

The system will store and process this memory.

⸻

Test Memory Retrieval

Retrieve stored memory.

POST
http://localhost:3000/v1/memory/retrieve

Example request body

{
“tenant_id”: “demo”,
“workspace_id”: “main”,
“user_id”: “user1”,
“query”: “What programming language do I like?”
}

The system will search memory and return relevant results.

⸻

Verify Stored Memory

You can inspect memory directly in Postgres.

docker exec -it docker-postgres-1 psql -U hybrid -d hybrid_memory

Then run

SELECT * FROM memories;

⸻

Development

Run the system in development mode

pnpm run dev

This enables live reload and debugging.

⸻

Project Status

Hybrid Memory Engine is currently in an experimental research stage.

The core memory architecture and infrastructure are implemented. Ongoing development focuses on evaluation frameworks, improved retrieval pipelines, and agent integrations.

⸻

Roadmap

Add memory recall benchmarks
Improve retrieval ranking and filtering
Support procedural memory for AI agents
Integrate with agent frameworks
Build real-world demos and evaluation tools

⸻

Vision

Future AI systems will require persistent memory architectures.

Hybrid Memory Engine explores how structured memory systems combining semantic search, graph relationships, and lifecycle evolution can enable more reliable long-term AI reasoning.

⸻

License

MIT License
