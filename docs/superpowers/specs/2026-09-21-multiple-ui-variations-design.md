# Multiple UI Variations Design

## Summary

Genesis will interpret every submitted prompt with a small OpenAI planning call. A normal prompt continues through the existing single-generation path and streams model output directly into the editor. A prompt that asks for alternatives enters a variation workflow: Genesis plans four meaningfully different UI directions, generates four isolated applications, validates and grades them without exposing their variation instructions to the grader, persists only the two finalists, and asks the user to choose one before loading the code editor.

The first release is OpenAI-only. All four candidates use the same user-selected model, reasoning effort, and sampling configuration so the comparison measures the generated applications rather than unequal model budgets.

## Goals

- Recognize natural-language requests for multiple alternatives without requiring a special command or control.
- Generate exactly four candidates for every prompt classified as a variation request.
- Preserve the same requested features and HighLevel behavior across all four candidates.
- Produce meaningful differences in information architecture, interaction model, composition, density, and visual direction.
- Keep the current direct file streaming experience unchanged after a prompt is classified as a single generation.
- Validate and grade all viable candidates while their code remains in Firebase Function memory.
- Save only the best two candidate codebases to Firestore.
- Present the two finalists neutrally and let the user decide which becomes the active project.
- Preserve the unselected finalist so the user can return to it later.
- Emit honest, event-backed progress throughout the slower multi-candidate workflow.

## Non-goals

- Supporting Anthropic or other non-OpenAI providers.
- Letting users choose the candidate count in the first release.
- Streaming raw code from all four candidates into the editor while they are being generated.
- Allowing variation instructions, generation order, model metadata, or sampling parameters to affect grading.
- Automatically training or fine-tuning a model from user choices.
- Replacing the existing single-generation protocol, snapshot history, or editor workflow.
- Keeping the two discarded candidate codebases after ranking completes.

## User Experience

### Single generation

1. The user submits a prompt.
2. Genesis classifies it as a single generation.
3. The existing `generation_started`, summary token, file, usage, snapshot, and completion events stream directly to the client.
4. The editor, preview, persistence, cancellation, partial-generation recovery, and diff behavior remain unchanged.

The planning call adds a short intent-detection phase before application generation begins, but Genesis does not buffer the application response. Once the application model starts producing output, every existing delta continues to flow directly to the UI.

### Variation generation

1. The user submits a prompt using language such as "create multiple variations", "show me a few directions", or "give me different versions".
2. Genesis reports that it is preparing four directions.
3. The comparison workspace replaces the code and preview panels while the conversation panel remains available.
4. Genesis shows event-backed activity for planning, candidate generation, validation, grading, and finalist preparation. It never displays fabricated percentages.
5. When grading finishes, Genesis reveals two sandboxed previews named Direction A and Direction B.
6. The UI shows concise evidence-based strengths and meaningful risks for each finalist, but it does not show raw numeric scores or an initial recommendation badge.
7. The user selects one finalist.
8. Genesis atomically promotes the selection to the project's active files and creates a normal snapshot.
9. The comparison workspace transitions to the normal code editor and preview, hydrated with the selected files.
10. The unselected finalist remains accessible from variation history and can later be restored through the normal snapshot semantics.

The two finalists are assigned to the left and right positions independently of internal rank. The server returns stable candidate IDs; the client derives a stable left/right order from the variation-set ID so refreshing the page does not swap the choices.

## Prompt Planning

### One structured planning call

Every prompt is first sent to an OpenAI planning model with structured output. The default planner model is `gpt-5.4-mini` with low reasoning effort. Its schema is:

```ts
type GenerationPlan = {
  mode: 'single' | 'variations'
  confidence: number
  featureContract: {
    requiredFeatures: string[]
    optionalFeatures: string[]
    invariants: string[]
  }
  variants: Array<{
    id: string
    title: string
    designIntent: string
    informationArchitecture: string
    interactionModel: string
    visualDirection: string
    density: 'compact' | 'balanced' | 'spacious'
    differentiators: string[]
  }>
}
```

For `single`, `variants` must be empty. For `variations`, it must contain exactly four entries.

`confidence` is bounded from zero to one. If the planning request fails, times out, returns invalid structured output, or classifies a variation request with confidence below 0.8, Genesis falls back to `single`. This failure mode must not prevent ordinary app generation.

### Planner requirements

The planner receives the raw user prompt, bounded project context, recent messages, and the names of current files. It does not receive full current file contents because it is planning intent rather than writing code.

For a variation request, the planner must:

- extract one shared feature contract before describing candidates;
- preserve all explicit requested functionality in `requiredFeatures`;
- use `invariants` for shared data sources, HighLevel entities, safety behavior, and explicit product constraints;
- create exactly four coherent briefs;
- make every pair differ on at least three of information architecture, interaction model, composition, density, or visual direction;
- avoid describing any brief as better, safer, more complete, or more likely to win;
- avoid adding product capabilities not supported by the raw prompt;
- produce directions that can all be implemented with the existing three-file Vue runtime.

### Candidate generation

Each candidate is a separate OpenAI Responses request. It receives:

- the original raw user prompt;
- the shared feature contract;
- exactly one variation brief;
- the same current files and recent project context;
- the existing Genesis application system prompt;
- an instruction to preserve every required capability and use the brief only to shape presentation and interaction.

Candidates never see one another's brief or output. All candidates use the user's selected model and the same low reasoning effort used by the current generator. The first release does not vary temperature between candidates; it omits unsupported sampling parameters and relies on the briefs plus independent sampling for diversity.

Candidate generation runs with a concurrency limit of two and uses all-settled semantics. A failure in one request does not cancel other candidates. User cancellation aborts the planner, every active candidate request, queued candidate work, grading, and finalist streaming.

## Validation and Grading

Variation metadata is never included in a grader request. Before grading, candidates receive opaque randomized aliases so the grader cannot infer generation order or internal rank.

### Deterministic qualification

Every completed candidate passes the existing `generatedApplicationSchema` and security validation, extended with variation-specific checks:

- exactly `index.html`, `styles.css`, and `app.js` are present and within size limits;
- the mandatory Vue runtime invariant holds;
- generated JavaScript parses;
- forbidden APIs, credentials, unsafe HTML behavior, and invalid dependencies are absent;
- every referenced HighLevel bridge operation is supported and uses its documented request shape;
- required loading, empty, error, and success states exist for relevant asynchronous features;
- all explicitly required feature-contract items have evidence in markup or code;
- accessible names, semantic controls, keyboard operation, and responsive rules have basic static evidence.

A security, schema, parse, or mandatory-runtime failure makes the candidate ineligible. Other deterministic checks produce evidence and a bounded soft score for use in the final grade and as a fallback if model grading is unavailable.

At least two candidates must qualify. If fewer than two qualify, Genesis persists no variation candidates and ends with `VARIATION_INSUFFICIENT_CANDIDATES`. The existing active project remains unchanged.

### Independent rubric grading

The grader model is configurable through `OPENAI_VARIATION_GRADER_MODEL` and defaults to `gpt-5.4` with medium reasoning effort. It receives the raw prompt, shared feature contract, deterministic evidence, and one anonymized candidate at a time. It returns structured scores and evidence using this 100-point rubric:

| Criterion | Weight |
| --- | ---: |
| Prompt and feature fidelity | 30 |
| Functional and HighLevel API correctness | 25 |
| State management and failure handling | 15 |
| Usability and information hierarchy | 10 |
| Accessibility | 10 |
| Responsive behavior | 5 |
| Code coherence and maintainability | 5 |

The grader must cite concrete file-level evidence for strengths, risks, and deductions. Information architecture choice, density, visual style, layout family, model randomness, candidate order, and variation brief compliance are not scoring criteria except where an implementation violates an explicit user requirement.

### Blinded pairwise comparison

The three highest independently scored candidates, or all candidates when only two qualify, enter a single blinded pairwise comparison. Pairwise judgments consider only the same rubric criteria and return a winner or tie with evidence and confidence for every compared pair.

Final ranking combines:

- 70 percent normalized independent rubric score;
- 30 percent normalized pairwise result.

Ties resolve by feature fidelity, then functional correctness, then the opaque candidate alias. Diversity is measured only as a batch diagnostic and never adds points.

The model grader is retried once for a transport or parse failure. If it remains unavailable, Genesis ranks candidates using deterministic qualification evidence, marks the variation set `gradingMode: 'deterministic_fallback'`, and tells the user that automated comparison was limited without exposing internal infrastructure details.

## Function Memory and Concurrency

All four candidate applications remain in the `generateApp` Firebase Function process until ranking completes. Each candidate is represented by its parsed `GeneratedApplication`, usage record, validation result, and grade. Raw provider event histories are not retained.

The current three files allow up to roughly 300,000 characters per application, so four parsed applications are small relative to the function's 512 MiB allocation. The implementation must nevertheless bound all planner, generator, and grader outputs with schemas and existing file limits.

Execution duration and upstream rate limits are more important than memory. The multi-variant branch therefore:

- generates at most two candidates concurrently;
- starts the second pair as the first pair settles;
- keeps the existing project-level generation lock for the entire batch;
- uses one shared abort controller tree for cancellation;
- increases the multi-variant function timeout from 300 to 540 seconds while retaining the current 512 MiB memory allocation;
- sends SSE heartbeats throughout planner, generation, grading, and finalist transfer phases.

The rate limiter charges one generation unit for a single request and four generation units for a variation request. Planner and grader calls do not consume user-visible generation units. Weighted quota consumption must be atomic so two simultaneous requests cannot bypass the minute or daily limit.

## Streaming Protocol

The existing `GenerationEvent` union and event behavior remain valid for the single path. Multi-variant mode extends the protocol with variant-aware events:

```ts
type VariationGenerationEvent =
  | { type: 'variation_planning_started' }
  | { type: 'variation_set_started'; variationSetId: string; count: 4 }
  | { type: 'candidate_started'; candidateId: string; index: number }
  | {
      type: 'candidate_progress'
      candidateId: string
      phase: 'summary' | 'markup' | 'styles' | 'logic'
    }
  | { type: 'candidate_complete'; candidateId: string }
  | { type: 'candidate_failed'; candidateId: string; recoverable: boolean }
  | { type: 'variation_validation_started'; completedCount: number }
  | { type: 'variation_validation_complete'; eligibleCount: number }
  | { type: 'variation_grading_started'; eligibleCount: number }
  | { type: 'variation_grading_complete'; gradingMode: 'full' | 'deterministic_fallback' }
  | {
      type: 'finalist_metadata'
      variationSetId: string
      finalists: Array<{
        candidateId: string
        displayName: 'Direction A' | 'Direction B'
        summary: string
        strengths: string[]
        risks: string[]
      }>
    }
  | { type: 'finalist_file_start'; candidateId: string; path: string; language: string }
  | { type: 'finalist_file_delta'; candidateId: string; path: string; delta: string }
  | { type: 'finalist_file_complete'; candidateId: string; path: string; size: number; sha256: string }
  | { type: 'finalists_ready'; variationSetId: string }
  | { type: 'variation_complete'; variationSetId: string }
```

Candidate progress is derived from real structured-stream milestones; it is not time-based. The UI may rotate copy within the current truthful phase but may not claim that a new phase or percentage has been reached without a corresponding event.

The server persists the finalist records before emitting `finalist_metadata`. It then streams the two finalist file sets from its in-memory results in bounded chunks. If the client disconnects during finalist transfer, it can reload both persisted finalists through an authenticated variation-set endpoint.

## Persistence Model

### Variation set

```text
projects/{projectId}/variationSets/{variationSetId}
```

Fields:

```ts
type VariationSetDocument = {
  prompt: string
  generationId: string
  baseSnapshotId?: string
  status: 'ready' | 'selected' | 'failed' | 'cancelled'
  requestedCount: 4
  eligibleCount: number
  gradingMode: 'full' | 'deterministic_fallback'
  initialSelectedCandidateId?: string
  activeCandidateId?: string
  model: string
  aggregateUsage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  createdAt: Timestamp
  selectedAt?: Timestamp
}
```

The variation-set document does not retain discarded code, variation briefs, discarded-candidate grades, or discarded-candidate identifiers. It stores only the aggregate information needed to resume and audit the user workflow.

### Finalists

```text
projects/{projectId}/variationSets/{variationSetId}/candidates/{candidateId}
```

Exactly two candidate documents are written for a successful set:

```ts
type VariationFinalistDocument = {
  internalRank: 1 | 2
  displayName: 'Direction A' | 'Direction B'
  summary: string
  files: Record<'index.html' | 'styles.css' | 'app.js', string>
  strengths: string[]
  risks: string[]
  scoreBreakdown: Record<string, number>
  model: string
  promotedSnapshotId?: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  createdAt: Timestamp
}
```

Security rules must allow an owner to read variation-set metadata and finalists but never write selection or candidate data directly.

When a set becomes ready, the same transaction sets `projects/{projectId}.pendingVariationSetId` to the variation-set ID. This pointer allows a reload to restore comparison mode without listing or scanning historical sets. Cancellation, terminal failure, or successful selection removes the pointer only when it still references that set.

### Conversation persistence

The user prompt is persisted once when the variation batch begins. Candidate summaries are not added as four assistant messages. When finalists become ready, Genesis persists one assistant message stating that two directions are ready. When the user selects a finalist, the selected application's summary becomes the normal assistant-generation message associated with the created snapshot.

## HTTP API

The existing generation endpoint remains the entry point:

```text
POST /v1/projects/{projectId}/generations
```

The server determines single or variation behavior from the structured plan. The client does not send a variation flag in the first release.

Add these authenticated owner-only routes:

```text
GET /v1/projects/{projectId}/variation-sets/{variationSetId}
POST /v1/projects/{projectId}/variation-sets/{variationSetId}/selection
```

The GET response contains the variation-set metadata and the two finalist records. The selection request is:

```json
{
  "candidateId": "candidate-id"
}
```

Initial selection validates that the set is ready, the candidate is one of its two finalists, the project has not been deleted, and the project's current `latestSnapshotId` still equals the set's `baseSnapshotId`. A mismatch returns a conflict instead of overwriting work created in another tab. In one Firestore transaction it:

- creates a standard generation snapshot using the selected files;
- replaces the project's active file documents;
- updates `latestSnapshotId` and `updatedAt`;
- records immutable `initialSelectedCandidateId`, mutable `activeCandidateId`, and `selectedAt` on the variation set;
- removes the matching `pendingVariationSetId` from the project;
- persists the selected assistant summary.

Selecting the already-active candidate is idempotent and returns its existing promoted snapshot. If the user later chooses the other finalist from variation history, the same endpoint preserves `initialSelectedCandidateId`, creates a backup of current active files using the existing restore semantics, promotes the requested finalist into a new snapshot, and updates only `activeCandidateId`. This later switch refuses to overwrite an unrelated in-flight generation and remains recoverable through snapshot history.

## Frontend State and Components

The workspace generation state becomes an explicit union rather than additional loosely related booleans:

```ts
type WorkspaceGenerationState =
  | { mode: 'idle' }
  | { mode: 'single'; generationId: string }
  | {
      mode: 'variations-running'
      generationId: string
      variationSetId?: string
      candidates: Record<string, CandidateProgress>
      phase: VariationPhase
    }
  | {
      mode: 'variations-ready'
      variationSetId: string
      finalists: [VariationFinalist, VariationFinalist]
    }
  | { mode: 'variation-selecting'; variationSetId: string; candidateId: string }
```

Create focused components instead of expanding the existing 1,200-line `WorkspaceShell.vue` further:

- `VariationProgress.vue`: truthful generation, validation, and grading activity.
- `VariationComparison.vue`: responsive two-finalist comparison and selection orchestration.
- `VariationPreview.vue`: one sandboxed candidate preview with selection affordance.
- `VariationEvidence.vue`: concise strengths and risks.
- `useVariationGeneration.ts`: event reduction, finalist buffering, cancellation, reload, and selection state.

The normal editor is not instantiated for multi-variant mode until selection succeeds. Finalist source is buffered as plain strings and rendered only through the existing sandboxed `buildSrcdoc` path.

### Visual direction

The comparison experience follows the requested `gpt-taste` principles while remaining a product workflow rather than a marketing page:

- a wide status heading limited to two lines;
- an exact two-column, gapless desktop preview grid with no unused cells;
- clear dark-theme contrast and visible button labels;
- Direction A and Direction B use equal visual weight;
- evidence appears through restrained progressive disclosure rather than many decorative cards;
- mobile uses accessible tabs and a sticky selection action;
- no cheap numbered meta-labels, decorative badges, or oversized marketing copy;
- motion communicates candidate arrival, comparison readiness, hover/focus, and selection;
- reduced-motion users receive equivalent immediate state changes.

Before UI implementation, the `gpt-taste` preflight must record the deterministic design selection and verify typography width, gapless grid math, label cleanup, and button contrast. Because Genesis is Vue, use `gsap` and `ScrollTrigger` directly rather than React bindings. GSAP is isolated to the variation experience; existing Anime.js motion remains unchanged.

## Cancellation, Recovery, and Errors

- The current project generation lock covers planning through finalist persistence.
- Cancellation stops queued and active work and marks a created variation set `cancelled`; it never modifies active files.
- A client disconnect aborts active provider requests as it does today. If finalists were already persisted, the variation set remains `ready` and is reloadable.
- Candidate-specific failures are shown as neutral status changes, not raw provider errors.
- Fewer than two qualified candidates fails the comparison and leaves active files untouched.
- A failure while persisting finalists emits an error and exposes no in-memory-only choices.
- A failure while selecting a finalist keeps comparison mode open and allows retry.
- Reloading a project with an unselected ready variation set restores the comparison screen.
- Existing partial-generation persistence remains exclusive to the single-generation flow. Failed variation candidates are discarded rather than written as partial snapshots.

## Observability

Structured logs must include `generationId`, `variationSetId`, opaque `candidateId`, stage, model, duration, validation outcome, grading mode, and token usage. Logs must not include full prompts or generated file contents.

Measure:

- planner classification latency and fallback rate;
- variation requests as a percentage of generations;
- per-candidate generation latency and failure rate;
- number of eligible candidates per set;
- full versus deterministic-fallback grading rate;
- total variation latency and token usage;
- finalist selection latency;
- how often users select internal rank one versus rank two;
- restore rate for the initially unselected finalist.

User preference data is product telemetry for rubric calibration. It is not sent to model training automatically.

## Testing Strategy

### Backend unit tests

- planning schema accepts one single plan and exactly four variation briefs;
- invalid, timed-out, or low-confidence planning falls back to single;
- four candidates receive the same feature contract and different briefs;
- concurrency never exceeds two;
- one candidate failure does not cancel the remaining candidates;
- cancellation aborts active and queued candidates;
- validation removes ineligible candidates;
- fewer than two eligible candidates returns the specified terminal error;
- grading prompts contain no variation briefs, rank, order, model metadata, or display position;
- rubric weights total 100 and ranking uses the specified 70/30 formula;
- grader failure retries once and then uses deterministic fallback;
- only two finalist documents contain candidate code;
- weighted rate-limit accounting charges one or four units atomically;
- selection is owner-only, validates membership, is atomic, and is idempotent.

### Protocol and service tests

- existing single-generation SSE tests remain unchanged and passing;
- multi-variant SSE blocks parse across arbitrary network chunk boundaries;
- interleaved candidate progress is reduced by candidate ID;
- finalist file chunks reconstruct exactly and validate hashes;
- reconnect loads persisted finalists after interrupted transfer;
- cancellation and insufficient-candidate errors are terminal.

### Frontend component tests

- single events continue updating the existing editor immediately;
- variation progress never mounts or mutates Monaco;
- only real events advance the displayed phase;
- finalist files remain isolated by candidate ID;
- left/right order is stable across reloads and independent of rank;
- selection failure preserves both previews and allows retry;
- successful selection hydrates files and returns to the normal workspace;
- keyboard navigation, accessible names, focus management, and reduced motion work.

### End-to-end tests

- a normal prompt streams directly into the editor as before;
- a natural-language variations prompt produces four candidates and two choices;
- choosing either direction activates its exact files and creates a snapshot;
- refreshing during a ready comparison restores both finalists;
- stopping during planning, generation, and grading leaves active files unchanged;
- responsive comparison works at desktop and mobile viewport widths.

## Rollout

Gate the variation branch behind `ENABLE_MULTIPLE_VARIATIONS`, disabled by default outside development. Deploy the schema, rules, routes, and backend orchestration before enabling the comparison UI. Enable for internal accounts first, inspect latency, failure, grading-fallback, and selection telemetry, then expand gradually.

The first production threshold requires at least 95 percent of variation requests to yield two qualified finalists, no regression in single-generation streaming tests, and no observed case where discarded candidate code is persisted.
