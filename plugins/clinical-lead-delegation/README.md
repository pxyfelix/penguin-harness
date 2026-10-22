# Clinical Lead Delegation

Installs the Lead Statistician's routing and acceptance workflow. The Lead verifies the real
Project Agent ids, stages shared inputs in the Workspace, dispatches independent work in
parallel, and consolidates results with an explicit conflict check.

Install this package only on the Project's `lead_statistician` Agent. The General Agent's
entry-point routing is provided separately by `clinical-task-routing`.
