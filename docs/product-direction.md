# Product direction

Research Studio is a local-first environment for source management, evidence work, manuscripts, qualitative research, traceable generative assistance, and long-term research strategy. Features should deepen the scholarly workflow rather than accumulate disconnected tools.

## Embedded Microsoft learning layer

A future, durable product capability is a context-aware learning layer for the Microsoft ecosystem:

- Microsoft Foundry and Azure AI/Foundry tools
- Microsoft Fabric, OneLake, and Power BI
- Microsoft Copilot Studio
- Microsoft Purview
- Microsoft Entra

The layer should use the user's current research task, selected sources, and evidence context to produce ready-to-use prompts and step-by-step instructions. Its goal is proficiency, not opaque automation. Every guide should explain why each step matters, define concepts, include observable checkpoints and a practice task, and cite current official Microsoft sources.

This is not a Phase 1 cloud-integration commitment. The local library and evidence workflows remain useful without an account or network connection. Future Microsoft content providers must sit behind the provider-neutral `LearningGuideProvider` boundary, be explicitly invoked, and never receive source content by default. The user must be shown exactly what context would leave the device before any connected provider is used.

Guide content needs version and review dates because Microsoft product interfaces and terminology change. Generated prompts and instructions should be stored separately from user-authored research, retain their provider/content provenance, and never be presented as scholarly evidence.

## Delivery principles

1. Teach the mental model alongside the procedure.
2. Adapt depth to the user's demonstrated proficiency.
3. Ground guidance in official, current documentation.
4. Keep generated operational guidance distinct from research evidence.
5. Require explicit consent before any research context leaves the device.
6. Preserve an offline path for saved guides and user-authored learning notes.
