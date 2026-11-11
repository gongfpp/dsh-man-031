# Third-party notices

The plugin source code, scripts and documentation in this repository are MIT
licensed (see `LICENSE`). The files listed below are **not** covered by that
grant: they are bundled so the packaged plugin works offline, and are included
only for personal, non-commercial use together with this plugin. Do not extract,
re-license, redistribute or sell them separately.

## `assets/kobe.png`, `icon.png`, `docs/preview.png`

A fan-made edit of a widely circulated meme photo of Kobe Bryant holding a
bottle of iced tea. The edit only removed the blue background and cleaned the
outline; the person, face and any visible brand were not redrawn.

- Source article: https://www.sohu.com/a/796522661_121687421
- Source image: https://q0.itc.cn/q_70/images03/20240727/6f2674d4501f4e4daa75464b4fceb2ed.png

This repository does not hold and does not claim any right in that photograph,
in Kobe Bryant's likeness or estate, or in any brand shown in it. No license is
granted for those elements, and none of them are covered by the MIT grant above.
The material is used as unofficial fan content, is not affiliated with or
endorsed by Kobe Bryant, his estate, any brand shown in the image, DSH, or the
plugin index that lists this package, and all rights remain with the respective
rights holders. If a rights holder objects, the file will be removed from the
package and the plugin will fall back to a text-only popup.

## `assets/voices/` (offline announcement audio)

Generated in advance through the Volcengine Doubao speech service with a cloned
voice under the voice-cloning terms at
https://www.volcengine.com/docs/6561/1136414. The clone reference was an
AI-synthesized sample chosen by the maintainer, not a recording of a real person.
Nothing here is a new recording by Kobe Bryant, and none of the phrases used for
amounts were ever spoken by him. Playback happens locally; the plugin never calls
a speech service at runtime. The clips are shipped only so the packaged plugin
works offline and are not licensed for separate reuse.

## Pricing data and estimate implementation

`assets/provider-pricing.json`, `lib/public-pricing.js` and the price table they
derive from come from [dsh-cost-meter](https://github.com/Han-1413141/dsh-cost-meter),
which is MIT licensed. The original license text is kept in
`docs/PRICING-LICENSE.txt`. Exchange-rate snapshots come from the public
[ExchangeRate-API](https://open.er-api.com/v6/latest/USD) endpoint, with the source
and date recorded next to each snapshot.
