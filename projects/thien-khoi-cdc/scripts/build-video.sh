#!/usr/bin/env bash
# Build every hero video asset from one source clip (needs ffmpeg).
#
#   npm run video -- path/to/video.mp4
#   CROP=none npm run video -- clip.mp4           # source has no watermark to cut away
#   MASTER=master.mp4 npm run video -- clip.mp4   # reuse an already interpolated 60 fps master
#   WALK_END=18.5 npm run video -- clip.mp4       # force where the scroll walk-through ends (s)
#
# Output (public/assets/video/, public/assets/frames/poster.webp):
#   walk-1080.mp4 / walk-1080-rev.mp4   desktop scroll walk-through, forward + reversed
#   walk-720.mp4  / walk-720-rev.mp4    phones, forward + reversed
#   flythrough.mp4                      the whole clip, 1080p with audio (fullscreen player)
#
# The walk-through is the continuous shot from the start up to the first hard cut, found
# automatically, so scrolling never jumps between two different houses.
#
# Steps: crop the AI watermark corner -> motion-interpolate to 60 fps -> denoise -> Lanczos upscale
# -> sharpen -> H.264 with frequent keyframes (instant direction changes while scrolling).
set -euo pipefail

SRC="${1:?Usage: npm run video -- <source.mp4>}"
CROP="${CROP:-1120:630:0:0}"   # Gemini clips: keeps the frame left of the bottom-right sparkle
FPS="${FPS:-60}"
CRF="${CRF:-21}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/assets/video"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT" "$ROOT/public/assets/frames"

# keyframe every 0.25 s: scrolling back and forth seeks often
ENC=(-c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -g 15 -keyint_min 15 -sc_threshold 0 -movflags +faststart)
# bitrate caps keep the files light enough for mobile data
CAP_HD=(-maxrate 3500k -bufsize 7000k)
CAP_SD=(-maxrate 1700k -bufsize 3400k)

crop_filter=""
[ "$CROP" != "none" ] && crop_filter="crop=$CROP,"

if [ -n "${MASTER:-}" ]; then
  echo "1/6  Reusing master $MASTER"
  cp "$MASTER" "$TMP/master.mp4"
else
  echo "1/6  Interpolating to ${FPS} fps and sharpening (the slow step)…"
  ffmpeg -v error -stats -y -i "$SRC" \
    -vf "${crop_filter}minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,hqdn3d=1.5:1.5:3:3,scale=1920:1080:flags=lanczos,unsharp=5:5:0.8:5:5:0.0,cas=0.5" \
    -c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p -an "$TMP/master.mp4"
fi
DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/master.mp4")"

echo "2/6  Full film, 1080p with audio (fullscreen player)…"
ffmpeg -v error -stats -y -i "$TMP/master.mp4" -i "$SRC" -map 0:v -map 1:a? -shortest \
  "${ENC[@]}" "${CAP_HD[@]}" -g 60 -keyint_min 60 -crf "$CRF" -c:a aac -b:a 128k "$OUT/flythrough.mp4"

echo "3/6  Finding the end of the continuous walk-through…"
if [ -z "${WALK_END:-}" ]; then
  CUT="$(ffmpeg -i "$TMP/master.mp4" -vf "scale=320:-2,select='gt(scene,0.15)',showinfo" -an -f null - 2>&1 \
    | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 | awk '$1 > 2 { print; exit }')"
  if [ -n "$CUT" ]; then
    WALK_END="$(awk -v c="$CUT" 'BEGIN { printf "%.2f", c - 0.3 }')"
    echo "     hard cut at ${CUT}s -> walk-through ends at ${WALK_END}s"
  else
    WALK_END="$DUR"
    echo "     no hard cut -> using the whole clip (${WALK_END}s)"
  fi
fi
ffmpeg -v error -y -i "$TMP/master.mp4" -t "$WALK_END" -c:v libx264 -preset veryfast -crf 12 -an "$TMP/walk.mp4"

echo "4/6  Walk-through forward, 1080p + 720p…"
ffmpeg -v error -stats -y -i "$TMP/walk.mp4" "${ENC[@]}" "${CAP_HD[@]}" -crf "$CRF" -an "$OUT/walk-1080.mp4"
ffmpeg -v error -stats -y -i "$TMP/walk.mp4" -vf "scale=1280:720:flags=lanczos" "${ENC[@]}" "${CAP_SD[@]}" -crf $((CRF + 2)) -an "$OUT/walk-720.mp4"

echo "5/6  Walk-through reversed (in 2 s chunks to keep memory low)…"
ffmpeg -v error -y -i "$TMP/walk.mp4" -c:v libx264 -preset veryfast -crf 12 -g "$((FPS * 2))" \
  -f segment -segment_time 2 -reset_timestamps 1 "$TMP/seg_%03d.mp4"
: > "$TMP/list.txt"
for seg in $(ls "$TMP"/seg_*.mp4 | sort -r); do
  ffmpeg -v error -y -i "$seg" -vf reverse -c:v libx264 -preset veryfast -crf 12 "${seg%.mp4}_r.mp4"
  echo "file '${seg%.mp4}_r.mp4'" >> "$TMP/list.txt"
done
ffmpeg -v error -y -f concat -safe 0 -i "$TMP/list.txt" -c copy "$TMP/walk-rev.mp4"
ffmpeg -v error -stats -y -i "$TMP/walk-rev.mp4" "${ENC[@]}" "${CAP_HD[@]}" -crf "$CRF" -an "$OUT/walk-1080-rev.mp4"
ffmpeg -v error -stats -y -i "$TMP/walk-rev.mp4" -vf "scale=1280:720:flags=lanczos" "${ENC[@]}" "${CAP_SD[@]}" -crf $((CRF + 2)) -an "$OUT/walk-720-rev.mp4"

echo "6/6  Poster frame…"
ffmpeg -v error -y -i "$OUT/walk-1080.mp4" -frames:v 1 -c:v libwebp -quality 82 "$ROOT/public/assets/frames/poster.webp"

ls -lh "$OUT"
echo
echo "Done. Film ${DUR}s, scroll walk-through 0-${WALK_END}s."
echo "Chapter text positions are fractions of the walk-through: data-at on each [data-chap] in public/index.html."
