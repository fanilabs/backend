# MP4 evidence header recognition

Dispute upload checks bytes before hashing, saving or inserting evidence. The
service, signature helper and exported schema helper share `matchesMp4Header`.
The HTTP schema still checks the MIME allowlist and upload sizes; the upload
service performs the header check after the existing dispute/ownership guards.
No file extension or client MIME declaration substitutes for matching bytes.

The recognizer follows the basic box and FileTypeBox syntax in
[ISO/IEC 14496-12:2008, sections 4.2–4.3](https://cdn.standards.iteh.ai/samples/51533/c8233bd62f144bdda13c99156e984616/ISO-IEC-14496-12-2008.pdf).
The leading box type is at byte4, after its size. Standard, extended-size and
size-to-EOF forms are supported. The complete declared box must fit the supplied
view, contain major-brand/minor-version fields and an aligned array of printable
four-character brands. Extended sizes are compared exactly with bigint.

This is bounded container-header recognition, **not whole-video validation or a
content-safety guarantee**. It does not scan for a marker elsewhere, traverse
preceding boxes, verify a brand registry/profile, inspect later boxes or decode
tracks/codecs. A matching header alone does not establish that a file is a valid,
playable or safe video. A leading `ftyp` remains the supported recognition scope.

Malformed/truncated MP4 headers retain the existing400/VALIDATION_ERROR response
before storage or metadata writes. Authorization, stable evidence ownership,
SHA256 of the exact uploaded bytes, configured decoded/base64/body limits and
storage/failure behavior are unchanged. Other MIME checks are unchanged. Worker
execution remains restricted; this repair does not enable any background job.
