# Lessons from document retrieval

These are observed failure patterns, not claims about the permanent availability of any search provider.

- A requested recent 13-volume series was represented by four older volumes. The right status is partial set plus different edition, even if all four PDFs parse.
- Several book requests yielded older editions. A title match alone did not satisfy the edition requirement.
- Publisher `bfm` files contained a 28-page table of contents and one-page covers, not the book. URL metadata and PDF integrity did not prove completeness.
- Text-and-data-mining links in bibliographic metadata were mistaken for free full-text access. Check publisher access/licence and the actual content.
- Exact archive filenames used typographic apostrophes. Encoding the names returned by metadata fixed 404s; guessing normalised names did not.
- Download waits and oversized base64 outputs exhausted browser tool budgets. Prefer managed file download or bounded exports, verify the resulting file and respect current tool limits.
- A shell recipe assumed GNU `timeout` and associative-array syntax unavailable in the running environment. Portable Python utilities and explicit dependency checks avoid that assumption.

Evidence sources: Crossref text-and-data-mining documentation (https://www.crossref.org/documentation/retrieve-metadata/text-and-data-mining/) and Internet Archive basic downloading guide (https://archivesupport.zendesk.com/hc/en-us/articles/360016398872-Downloading-A-Basic-Guide). Access must be confirmed for the actual item.
