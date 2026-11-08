# Adding new shop photos to the website

Staff drop photos into the shared Google Drive folder "Agrawal Stores Photos"
(Drive folder id 1OkzHTBXC5wV5ez3QCycGR8_ljfYQIoVv). One subfolder per school, plus
"Common (many schools)" and "Other Sections" (with its own subfolders).

## Folder -> site mapping
| Drive folder | slug in data/schools.json |
|---|---|
| St Norbert | st-norbert |
| St Joseph | st-joseph |
| Chameli Devi | chameli-devi-public-school |
| La Sagesse | la-sagesse |
| Alpine Academy | alpine-academy |
| St Xavier | st-xavier |
| IPS | ips |
| Annie Besant | annie-besant |
| Medicaps | no page yet: process the photo, keep it in assets/uniforms/medicaps/, tell the owner |
| Common (many schools) | file name lists the schools (e.g. navy-blazer_alpine_joseph.jpg); add to each named school |
| Other Sections/* | no pages yet: keep in assets/gallery/<section-slug>/, tell the owner |

## Steps
1. List image files in the folders. Skip any whose Drive file id is in data/processed-photos.json.
2. Download each new file to a temp folder.
3. `pip install --break-system-packages rembg onnxruntime opencv-python-headless pillow numpy`
4. `python3 scripts/studio.py in.jpg out.webp` (add `--loose` for blazers, jackets, anything not in a plastic bag).
   If rembg cannot download its model, stop and report that. Do not publish uncut photos.
5. Save to assets/uniforms/<slug>/<name>.webp and add {"file","caption"} to that school's uniformPhotos in data/schools.json.
   Caption = the item in plain words from the file name, e.g. "Navy blue blazer (winter)". Never put a price in a caption.
6. Record the Drive file id in data/processed-photos.json.
7. `node scripts/build-schools.mjs && npm run build && npm test` (all must pass).
8. Push a NEW branch and open a pull request. DO NOT MERGE. The owner approves first.
9. Tell the owner which photos were added and any that need a decision.
