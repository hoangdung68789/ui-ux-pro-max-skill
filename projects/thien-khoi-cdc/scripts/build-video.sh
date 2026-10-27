#!/usr/bin/env bash
# Build every hero video asset from one source clip (needs ffmpeg).
#
#   npm run video -- path/to/video.mp4
#   CROP=none npm run video -- clip.mp4      # source has no watermark to cut away
#   MASTER=master.mp4 npm run video -- clip.mp4   # reuse an already interpolated 60 fps master
#
# Output (public/assets/video/, public/assets/frames/poster.webp):
#   flythrough.mp4          1080p 60 fps, with audio  -> desktop hero + fullscreen player
#   flythrough-rev.mp4      1080p 60 fps, reversed    -> desktop hero when scrolling up
#   flythrough-720.mp4      720p 60 fps               -> phones
#   flythrough-720-rev.mp4  720p 60 fps, reversed     -> phones when scrolling up
#
# Steps: crop the AI watermark corner -> motion-interpolate to 60 fps -> denoise -> Lanczos upscale
# -> sharpen -> H.264 with a keyframe every 0.5 s (fast seeking when the scroll direction flips).
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

ENC=(-c:v libx264 -preset slow -profile:v high -pix_fmt yuv420p -g 30 -keyint_min 30 -sc_threshold 0 -movflags +faststart)
# bitrate caps keep each file light enough for mobile data (~12 MB at 1080p, ~6 MB at 720p for 30 s)
CAP_HD=(-maxrate 3200k -bufsize 6400k)
CAP_SD=(-maxrate 1600k -bufsize 3200k)

crop_filter=""
[ "$CROP" != "none" ] && crop_filter="crop=$CROP,"

if [ -n "${MASTER:-}" ]; then
  echo "1/5  Reusing master $MASTER"
  cp "$MASTER" "$TMP/master.mp4"
else
  echo "1/5  Interpolating to ${FPS} fps and sharpening (the slow step)…"
  ffmpeg -v error -stats -y -i "$SRC" \
    -vf "${crop_filter}minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,hqdn3d=1.5:1.5:3:3,scale=1920:1080:flags=lanczos,unsharp=5:5:0.8:5:5:0.0,cas=0.5" \
    -c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p -an "$TMP/master.mp4"
fi

echo "2/5  Forward 1080p (with audio)…"
ffmpeg -v error -stats -y -i "$TMP/master.mp4" -i "$SRC" -map 0:v -map 1:a? -shortest \
  "${ENC[@]}" "${CAP_HD[@]}" -crf "$CRF" -c:a aac -b:a 128k "$OUT/flythrough.mp4"

echo "3/5  Reversed 1080p (in 2 s chunks to keep memory low)…"
ffmpeg -v error -y -i "$TMP/master.mp4" -c:v libx264 -preset veryfast -crf 12 -g "$((FPS * 2))" \
  -f segment -segment_time 2 -reset_timestamps 1 "$TMP/seg_%03d.mp4"
: > "$TMP/list.txt"
for seg in $(ls "$TMP"/seg_*.mp4 | sort -r); do
  ffmpeg -v error -y -i "$seg" -vf reverse -c:v libx264 -preset veryfast -crf 12 "${seg%.mp4}_r.mp4"
  echo "file '${seg%.mp4}_r.mp4'" >> "$TMP/list.txt"
done
ffmpeg -v error -stats -y -f concat -safe 0 -i "$TMP/list.txt" "${ENC[@]}" "${CAP_HD[@]}" -crf "$CRF" -an "$OUT/flythrough-rev.mp4"

echo "4/5  720p versions for phones…"
ffmpeg -v error -stats -y -i "$OUT/flythrough.mp4" -vf "scale=1280:720:flags=lanczos" "${ENC[@]}" "${CAP_SD[@]}" -crf $((CRF + 2)) -an "$OUT/flythrough-720.mp4"
ffmpeg -v error -stats -y -i "$OUT/flythrough-rev.mp4" -vf "scale=1280:720:flags=lanczos" "${ENC[@]}" "${CAP_SD[@]}" -crf $((CRF + 2)) -an "$OUT/flythrough-720-rev.mp4"

echo "5/5  Poster frame…"
ffmpeg -v error -y -i "$OUT/flythrough.mp4" -frames:v 1 -c:v libwebp -quality 82 "$ROOT/public/assets/frames/poster.webp"

DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/flythrough.mp4")"
ls -lh "$OUT"
echo
echo "Done. Video length: ${DUR}s."
echo "Set the chapter resting points (seconds) in public/index.html -> data-stops=\"0,…,<= ${DUR}\""
