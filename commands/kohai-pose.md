---
description: Pose Kohai by directly setting bone rotations (advanced — accepts JSON)
argument-hint: <bones-json>  e.g. {"head":{"rx":0.4},"leftUpperArm":{"rz":-0.5}}
allowed-tools: ["Bash"]
---

The user invoked `/kohai-pose` with bones JSON: `$ARGUMENTS`

Available bone names: `head`, `neck`, `spine`, `hips`, `leftUpperArm`, `rightUpperArm`, `leftLowerArm`, `rightLowerArm`, `leftHand`, `rightHand`, `leftUpperLeg`, `rightUpperLeg`, `leftLowerLeg`, `rightLowerLeg`.

Each bone takes optional `rx`, `ry`, `rz` (radians) and `lerp` (interpolation rate, default 6).

```bash
curl -s -X POST -H "X-Kohai-Token: $(cat ~/.kohai/token)" -H "Content-Type: application/json" \
  -d "{\"bones\":$ARGUMENTS}" http://127.0.0.1:17455/control/pose
```

Confirm in one short sentence (e.g. `Pose applied: head rx=0.4`).

To clear all poses, instead POST to `/control/clear_pose` with `{}`.
