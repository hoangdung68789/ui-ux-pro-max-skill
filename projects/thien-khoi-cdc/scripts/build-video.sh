#!/usr/bin/env bash
# Build every hero video asset from one source clip (needs ffmpeg and node).
#
#   npm run video -- path/to/video.mp4
#   CROP=none npm run video -- clip.mp4              # source has no watermark to cut away
#   MOBILE_SRC=vertical.mp4 npm run video -- clip.mp4 # use your own 9:16 clip for phones
#   MASTER=master.mp4 npm run video -- clip.mp4      # reuse an interpolated 60 fps master (native size)
#   WALK_END=18.5 npm run video -- clip.mp4          # force where the scroll walk-through ends (s)
#
# Output (public/assets/video/, public/assets/frames/):
#   walk-1080.mp4 / walk-1080-rev.mp4   16:9 1920x1080, forward + reversed (desktops, phones held sideways)
#   walk-720.mp4  / walk-720-rev.mp4    16:9 1280x720 (low-resolution screens)
#   walk-916.mp4  / walk-916-rev.mp4    9:16 1080x1920 (phones held upright)
#   poster.webp, poster-916.webp        first frames
#
# Sharpness: the 60 fps master is kept at the source's own resolution and every output is
# upscaled exactly once (Lanczos), then sharpened for that size, at a generous bitrate.
#
# The walk-through is the continuous shot from the start up to the first hard cut, found
# automatically, so scrolling never jumps between two different houses.
#
# Without MOBILE_SRC the 9:16 cut is reframed from the 16:9 film: a vertical window pans across
# the frame following scripts/reframe-916.json ([time, centre] points; delete it for a centred crop).
set -euo pipefail

SRC="${1:?Usage: npm run video -- <source.mp4>}"
CROP="${CROP:-1120:630:0:0}"   # Gemini clips: keeps the frame left of the bottom-right sparkle
CROP_MOBILE="${CROP_MOBILE:-none}"
FPS="${FPS:-60}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/assets/video"
FRAMES="$ROOT/public/assets/frames"
REFRAME="${REFRAME:-$ROOT/scripts/reframe-916.json}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT" "$FRAMES"

# keyframe every 0.25 s: scrolling back and forth seeks often
ENC=(-c:v libx264 -preset slow -tune film -profile:v high -pix_fmt yuv420p -g 15 -keyint_min 15 -sc_threshold 0 -movflags +faststart -an)
# bitrates sized so each file stays under ~13 MB for a 20 s walk-through
Q_LG=(-crf 18 -maxrate 5200k -bufsize 10400k)
Q_SM=(-crf 20 -maxrate 2800k -bufsize 5600k)
Q_916=(-crf 19 -maxrate 5000k -bufsize 10000k)
LOSSLESS=(-c:v libx264 -preset veryfast -crf 10 -pix_fmt yuv420p -an)
# one Lanczos upscale, then a fine + a broad unsharp pass and contrast-adaptive sharpening.
# Stronger for the 9:16 cut, which is enlarged ~3x (the 16:9 files ~1.7x).
up() { echo "scale=$1:flags=lanczos+accurate_rnd,unsharp=5:5:1.2:5:5:0,unsharp=9:9:0.4:5:5:0,cas=0.6"; }
up_916() { echo "scale=$1:flags=lanczos+accurate_rnd,unsharp=5:5:1.4:5:5:0,unsharp=11:11:0.5:5:5:0,cas=0.7"; }

# 60 fps master at the source's own resolution: master <src> <crop|none> <out>
master() {
  local crop_filter=""
  [ "$2" != "none" ] && crop_filter="crop=$2,"
  ffmpeg -v error -stats -y -i "$1" \
    -vf "${crop_filter}minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,hqdn3d=1.2:1.2:2.5:2.5" \
    "${LOSSLESS[@]}" "$3"
}

# time of the first hard cut after 2 s, minus a safety margin (or the full length): walk_end <video>
walk_end() {
  local cut
  cut="$(ffmpeg -i "$1" -vf "scale=320:-2,select='gt(scene,0.15)',showinfo" -an -f null - 2>&1 \
    | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 | awk '$1 > 2 { print; exit }')"
  if [ -n "$cut" ]; then awk -v c="$cut" 'BEGIN { printf "%.2f", c - 0.3 }'
  else ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; fi
}

# reversed copy, built in 2 s chunks to keep memory low: reverse <in> <out>
reverse() {
  local dir="$TMP/rev_$(basename "$2" .mp4)"
  mkdir -p "$dir"
  ffmpeg -v error -y -i "$1" "${LOSSLESS[@]}" -g "$((FPS * 2))" -f segment -segment_time 2 -reset_timestamps 1 "$dir/seg_%03d.mp4"
  : > "$dir/list.txt"
  for seg in $(ls "$dir"/seg_*.mp4 | sort -r); do
    ffmpeg -v error -y -i "$seg" -vf reverse "${LOSSLESS[@]}" "${seg%.mp4}_r.mp4"
    echo "file '${seg%.mp4}_r.mp4'" >> "$dir/list.txt"
  done
  ffmpeg -v error -y -f concat -safe 0 -i "$dir/list.txt" -c copy "$2"
}

# forward + reversed delivery files: deliver <walk> <reversed walk> <name> <filter> <quality array name>
deliver() {
  local q="$5[@]"
  ffmpeg -v error -stats -y -i "$1" -vf "$4" "${ENC[@]}" "${!q}" "$OUT/$3.mp4"
  ffmpeg -v error -stats -y -i "$2" -vf "$4" "${ENC[@]}" "${!q}" "$OUT/$3-rev.mp4"
}

echo "1/5  60 fps master at native size (crop watermark, interpolate, denoise)…"
if [ -n "${MASTER:-}" ]; then cp "$MASTER" "$TMP/master.mp4"; else master "$SRC" "$CROP" "$TMP/master.mp4"; fi
IFS=x read -r MW MH < <(ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0:s=x "$TMP/master.mp4")

echo "2/5  Finding the end of the continuous walk-through…"
END="${WALK_END:-$(walk_end "$TMP/master.mp4")}"
echo "     walk-through: 0-${END}s (master ${MW}x${MH})"
ffmpeg -v error -y -i "$TMP/master.mp4" -t "$END" "${LOSSLESS[@]}" "$TMP/walk.mp4"
reverse "$TMP/walk.mp4" "$TMP/walk-rev.mp4"

echo "3/5  16:9 files (1080p, 720p)…"
deliver "$TMP/walk.mp4" "$TMP/walk-rev.mp4" walk-1080 "$(up 1920:1080)" Q_LG
deliver "$TMP/walk.mp4" "$TMP/walk-rev.mp4" walk-720 "$(up 1280:720)" Q_SM

echo "4/5  9:16 file for phones held upright…"
if [ -n "${MOBILE_SRC:-}" ]; then
  echo "     from your vertical clip $MOBILE_SRC"
  master "$MOBILE_SRC" "$CROP_MOBILE" "$TMP/m916.mp4"
  ffmpeg -v error -y -i "$TMP/m916.mp4" -t "$(walk_end "$TMP/m916.mp4")" "${LOSSLESS[@]}" "$TMP/walk916.mp4"
else
  [ -f "$REFRAME" ] && echo "     reframed from the 16:9 film along $(basename "$REFRAME")" || echo "     centred crop of the 16:9 film"
  CW=$(( MH * 9 / 16 / 2 * 2 ))   # 9:16 window inside the master
  node "$ROOT/scripts/reframe-path.js" "$REFRAME" "$FPS" "$END" "$MW" "$CW" > "$TMP/reframe.txt"
  ffmpeg -v error -stats -y -i "$TMP/walk.mp4" \
    -vf "sendcmd=f=$TMP/reframe.txt,crop@rf=w=$CW:h=$MH:x=$(( (MW - CW) / 2 )):y=0" \
    "${LOSSLESS[@]}" "$TMP/walk916.mp4"
fi
reverse "$TMP/walk916.mp4" "$TMP/walk916-rev.mp4"
deliver "$TMP/walk916.mp4" "$TMP/walk916-rev.mp4" walk-916 "$(up_916 1080:1920)" Q_916

echo "5/5  Posters…"
ffmpeg -v error -y -i "$OUT/walk-1080.mp4" -frames:v 1 -c:v libwebp -quality 85 "$FRAMES/poster.webp"
ffmpeg -v error -y -i "$OUT/walk-916.mp4" -frames:v 1 -c:v libwebp -quality 85 "$FRAMES/poster-916.webp"

ls -lh "$OUT"
echo
echo "Done. Scroll walk-through 0-${END}s."
echo "Chapter text positions are fractions of the walk: data-at on each [data-chap] in public/index.html."
