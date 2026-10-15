# Parallel Agent Session Tasks

## Session A

Branch name:create-readme/agent-a
Worktree directory:target-readme-agent
Task: create a document about how to install this app
Files or folders the agent may write to: in a file called installation-steps in current directory
Files or folders the agent may read but not write to: can't write into any other directory. It can't create any other file, or modify any other file in any directory in any way.
Commands the agent may run:
Definition of done: installation-steps is created with all the required steps


## Session B

Branch name: beautify-modal/agent-b
Worktree directory:target-modal-agent
Task: beautify the modal. Animate the launch of modal.
Files or folders the agent may write to: all files and folders inside /frontend
Files or folders the agent may read but not write to: do not write to installation-steps
Commands the agent may run:
Definition of done: modal animates when launched
