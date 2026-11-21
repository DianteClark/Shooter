# Bug sweep B, 2026-11-20

Scope: the 1120 wave (builds 1120-1 to 1120-13). Branch `sweepB`. Sweep A ran node sims and the first half of the UI
tests alongside, on the same two shared vCPUs (load average 11 to 21 the whole time), so every failure was retried
before it counted and timings only compare within a table. The session was cut twice by server restarts; work resumed
from the commits.

(In progress: tables below are filled as runs finish.)
