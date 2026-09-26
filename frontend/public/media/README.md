# Landing hero reel

Twelve films of engineers on site with their plans play behind the landing hero, one at a time,
each cross-fading into the next.

**The films are not kept in this repository.** They are large, they are not code, and a landing
page should serve them from object storage. This directory holds only this note; the `.mp4` files
beside it are ignored by git so a developer can keep a local copy here and work offline.

## Getting a local copy

The films are public. Fetch them straight from Pexels at 960x540:

```bash
cd frontend/public/media
for id in 8471052 8964796 8964792 8964773 6285685 8482292 8964291 8964731 8487521 6285679 8964793 8964772; do
  curl -sL -o "$id.mp4" "https://videos.pexels.com/video-files/$id/$id-sd_960_540_25fps.mp4"
done
```

Then rename them to the order below, or take them from the last commit that carried them
(`git log --diff-filter=D -- frontend/public/media`).

## The reel

| Order | File | Shot | Size | Source |
| --- | --- | --- | --- | --- |
| 1 | hero-01-architects-plans.mp4 | Two architects reviewing blueprints on site | 943 KB | https://www.pexels.com/video/8471052/ |
| 2 | hero-02-site-blueprint.mp4 | Two engineers holding a blueprint, steelwork behind them | 2.5 MB | https://www.pexels.com/video/8964796/ |
| 3 | hero-03-site-engineers.mp4 | Engineers with blueprints on a modern site | 1.4 MB | https://www.pexels.com/video/8964792/ |
| 4 | hero-04-bridge-plans.mp4 | Two engineers in hard hats discussing plans | 1.5 MB | https://www.pexels.com/video/8964773/ |
| 5 | hero-05-engineers-review.mp4 | Two engineers in helmets checking plans | 1.7 MB | https://www.pexels.com/video/6285685/ |
| 6 | hero-06-interior-plans.mp4 | Plans discussed inside a building under construction | 2.6 MB | https://www.pexels.com/video/8482292/ |
| 7 | hero-07-site-plans.mp4 | A worker reading site plans outdoors | 469 KB | https://www.pexels.com/video/8964291/ |
| 8 | hero-08-site-walk.mp4 | Engineers walking the site, plans in hand | 597 KB | https://www.pexels.com/video/8964731/ |
| 9 | hero-09-site-inspection.mp4 | An engineer inspecting the works in safety gear | 779 KB | https://www.pexels.com/video/8487521/ |
| 10 | hero-10-presenting-plan.mp4 | An architect in a hard hat presenting a plan | 1.5 MB | https://www.pexels.com/video/6285679/ |
| 11 | hero-11-site-devices.mp4 | Two workers planning on site with their devices | 1.7 MB | https://www.pexels.com/video/8964793/ |
| 12 | hero-12-scaffolding-consult.mp4 | Engineers consulting at a scaffolded site | 1.9 MB | https://www.pexels.com/video/8964772/ |

All twelve are from Pexels under the Pexels licence: free for commercial use, no attribution
required, modification allowed.

## Publishing them

```bash
REEL_S3_ENDPOINT=https://s3.eu-west-1.amazonaws.com \
REEL_S3_BUCKET=octapm-web-media \
REEL_S3_REGION=eu-west-1 \
REEL_S3_KEY=... REEL_S3_SECRET=... \
node scripts/upload-landing-reel.mjs --yes
```

Run it without `--yes` first: it lists what it would send and prints the address to set. The
script works with Amazon S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and MinIO, and it
reads the credentials from the environment without writing them anywhere.

Afterwards the deployment needs one line:

```
VITE_LANDING_VIDEO_BASE=https://octapm-web-media.s3.eu-west-1.amazonaws.com
```

`VITE_LANDING_VIDEO_URL` keeps the same list of names; the base is what moves them. With no base
set the names are used as they stand, which is how they are served from this directory in
development. With no films named at all, the hero paints the brand ground and requests nothing.

## The product tour

The hero's window frame plays `product-tour.webm`: eight seconds of the real workspace, filmed
on the seeded showcase project and looping without a cut. It follows the same rule as the reel —
served from object storage, ignored by git — while `product-tour-poster.png` beside it is
committed: it is the still that fills the frame until the film arrives, that older Safari (which
does not play WebM) shows instead, and that people who ask for less motion keep.

To film it again after the interface changes:

```bash
cd frontend
node scripts/film-product-tour.mjs <showcase project id>
```

It needs the API on :5000 and the web app on :5173, and the showcase project from
`node backend/scripts/demo/seed-showcase-project.js`. The deployment points
`VITE_PRODUCT_FILM_URL` at the published film, or leaves it and lets `VITE_LANDING_VIDEO_BASE`
carry it with the reel.
