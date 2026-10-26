---
name: Merge checker false positives
description: Repeated equals signs in comments can block automated conflict completion.
---

The automated merge-completion check can flag repeated equals signs inside ordinary CSS or JavaScript comments as unresolved conflict markers.

**Why:** After all actual Git conflict markers were removed, completion still rejected Mercury's HTML because decorative comment separators contained runs of equals signs.

**How to apply:** If Git's anchored conflict-marker search is clean but completion still reports markers, search for unanchored marker substrings too. Replace only decorative separators with hyphens; preserve code and finish through the merge-completion callback.
