Read the feature requirements doc matching $goal under docs-internal/product/features/.
Read the foundation blueprints under docs-internal/architecture/foundation-blueprints/ (backend.md, data-layer.md, frontend.md).
Read all existing feature blueprints under docs-internal/architecture/features/.
Read the current codebase structure.

Write the feature blueprint at docs-internal/architecture/features/ with:

## Solution Design

High-level technical architecture for this feature.

## Key Design Decisions

Rationale for approach choices, referencing foundation blueprint conventions.

## Data Model

Entities, fields, types, relationships. Reference existing tables from other blueprints. Define new tables where needed.

## API Implementation

Endpoints, HTTP methods, request/response models. Follow foundation backend conventions (FastAPI, SQLModel, dependency injection).

## UI Implementation

Key components, states, interactions. Use foundation frontend stack (React, shadcn/ui, Tailwind).

The blueprint must be detailed enough for an agent to implement without further clarification.
