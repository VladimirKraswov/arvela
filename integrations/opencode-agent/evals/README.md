# Real-incident coding evals

These cases come from accepted fixes in Arvela and TinyCAD, not
synthetic tasks. Each case pins a pre-fix Git revision, an accepted revision,
the incident description and an accepted test file. The replay script exports
both revisions to disposable directories, overlays the same accepted test and
runs only that focused test. It never modifies the source worktree, user
sessions, model services or project files.

Run from a Mac with the repositories and their dependencies already installed:

```sh
python3 replay.py --repo /Volumes/Extend/work/opencode-desktop
python3 replay.py --repo /Volumes/Extend/work/tiny-cad
```

On 2026-09-27 all three cases discriminated: the earlier revisions failed and
the accepted revisions passed (7, 9 and 10 tests, respectively). The scroll
baseline fails because the scroll controller did not exist yet; the malformed
tool and TinyCAD baselines fail behavioral assertions. Vite in the TinyCAD
fixture printed a nonblocking lookup warning for a separate local module;
the selected suite still exited zero on the accepted revision.

For a future agent comparison, give the same incident description and exported
base to each candidate, keep the accepted tests outside the candidate's working
copy, and grade sequentially with identical model/runtime settings. Record task
completion, test pass, permission denials, edit conflicts, time, token use and
human review of the diff. A single run is noisy; use repeated trials before
claiming a quality gain. Do not mix these code tests with UI or remote-machine
acceptance.
