# Camera videos

Put one clip per camera in this folder. The dashboard looks for these names (set in `lib/client/cameras.ts`):

| Camera | File |
| ------ | ---- |
| 1A Living room | `living.mp4` |
| 1B Dining | `dining.mp4` |
| 1C Kitchen | `kitchen.mp4` |
| 2A Grandma's room | `grandma.mp4` |
| 2B Kids' room | `kids.mp4` |
| 3A Front door | `frontdoor.mp4` |
| 3B Garage | `garage.mp4` |
| 4A Garden | `garden.mp4` |
| 4B Pool | `pool.mp4` |

MP4 (H.264) plays in every browser. Clips loop, muted.

Video files are ignored by git (see the repo's `.gitignore`), so recordings never get committed.
