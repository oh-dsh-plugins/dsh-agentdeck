# Third-party notices

DSH AgentDeck's source, icon, bundled role instructions and skills are provided under the [MIT license](LICENSE). No upstream agent-prompt collection is vendored.

## Runtime dependencies

The following packages are installed as dependencies rather than copied into AgentDeck's source. Their original notices and license files remain in their distributed packages.

| Package | License | Upstream |
| --- | --- | --- |
| `yaml` | ISC | https://github.com/eemeli/yaml |
| `zod` | MIT | https://github.com/colinhacks/zod |

The lockfile records the dependency versions used for source development. Host peer packages are supplied by the installed DSH version; their own licenses and notices apply. TypeScript, Node.js type declarations and test/development dependencies retain their respective upstream licenses.

## Host and optional integrations

DeepSeek Harness and its public Cordis/native packages are external host dependencies, not bundled copies. Optional BrowserSkill and MCP integrations use the installed host services and retain their own licenses, data handling and requirements. This repository does not redistribute browser extensions, provider credentials or model weights.

DeepSeek, OpenAI, GitHub and other product names belong to their respective owners. This project is independently maintained and is not affiliated with DeepSeek or OpenAI.
