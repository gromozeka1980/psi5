# Power (Engineering step @37be) — changes

Engine module: `web/src/engine/power.js`. Every flag is off by default (original behaviour, equivalence-checked).

## Flags

### `fixes.powerSkipUnaffordable`
- **Original** (@37be, distribution loop): `budget = budget - cost` is stored before the `budget >= 0` test, so a
  component that does not fit still has its demand subtracted. The budget then stays negative, and every component
  lower in the priority list gets no power, even a cheap one that would fit in what is left. A class shows "par" only if
  an earlier component of the same class got power.
- **Fixed**: a component that does not fit is skipped (unpowered) and the budget is left unchanged, so later
  components that fit still get power. `devPower` is 2 if every drawing component of the class is powered, 1 if only
  some are, 0 if none are. The emergency-battery drain test (`budget < 600`) then uses the real leftover supply.
- **Effect**: a short supply now drops only the components that don't fit, not everything below them. For example,
  with engines and weapons ranked first and 180 units left, the 200-unit scanner stays dark but the Fore Shield still
  gets power. Total demand, overload and gauges are unchanged.

### `fixes.lifeSupportOverload`
- **Original** (@37be, overload test `sysState[23] == 1`): a damaged E Life Sup puts the engineer in overload. A
  disabled one, which is worse and also starts his death timer (@4922), does not.
- **Fixed**: E Life Sup damaged or disabled (`sysState[23] != 2`) causes overload.
- **Effect**: with his life support down, the engineer works at the slow (overload) delays until it is repaired or he dies.

## Quirks kept on purpose (no flag)
- **Emergency charger draws while the battery is off** (@37be `d == 4` bypass). Component 11's on/off state is the
  *battery* switch (it gates the +600 supply and the drain). The charger itself has no switch, like the shield-battery
  charger (component 12, which is never switched). So the charger always draws 170 and charges whenever it gets power.
  That reads as design, not a bug.
- **"Too many active timers" overload test can never fire** (@37be `active > maxActiveTimers`). At most 11 requests can
  be pending, and every engineer's limit is 30 or more. It is dead code, but harmless. A fix would need a rule the
  original does not have (nobody knows what the limit was meant to measure), so the engine keeps the test as it is.
- **The emergency battery request jumps the queue** (devTimer[11] is a "force" flag, never aged): this is meant as a priority.
