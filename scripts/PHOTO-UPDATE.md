# Adding new shop photos to the website

There are two shared Google Drive folders:
- **Uniform photos:** "Agrawal Stores Photos" (folder id 1OkzHTBXC5wV5ez3QCycGR8_ljfYQIoVv).
  One subfolder per school, plus "Common (many schools)".
- **Shop section photos:** "Agrawal Stores Shop Section Photos" (folder id 1SAmrZWZUIkpmSSkpYxsCwwJnf6TTFHla).
  One subfolder per shop section. Inside a section, staff may use product-type subfolders
  (e.g. "Gifts & Toys/Toys & Soft Toys"). That subfolder name is the photo's `group` and shows as a heading
  on the section page. Photos placed straight in the section folder get no group.

## Uniform folder -> data/schools.json
| Drive folder | school slug |
|---|---|
| St Norbert | st-norbert |
| St Joseph | st-joseph |
| Chameli Devi | chameli-devi-public-school |
| La Sagesse | la-sagesse |
| Alpine Academy | alpine-academy |
| St Xavier | st-xavier |
| IPS | ips |
| Annie Besant | annie-besant |
| Medicaps | medicaps |
| Common (many schools) | file name lists the schools (e.g. navy-blazer_alpine_joseph.jpg); add to each named school |

## Shop section folder -> data/sections.json
| Drive folder | section slug |
|---|---|
| School Essentials & Stationery | essentials-stationery |
| Gifts & Toys | gifts-toys |
| Sports Goods | sports-goods |
| Lifestyle & Accessories | lifestyle-accessories |
| Seasonal & Festival | seasonal-festival |
| Shop (front, inside, displays) | not a product section: do not add to the site, ask the owner where it should go |

## Steps
1. List image files in both folders (including product-type subfolders). Skip any whose Drive file id is in data/processed-photos.json.
2. Download each new file to a temp folder.
3. `pip install --break-system-packages rembg onnxruntime opencv-python-headless pillow numpy`
4. `python3 scripts/studio.py in.jpg out.webp` for items in plastic bags (shirts, trousers, packed sweaters).
   Add `--loose` for everything else: blazers, jackets, gifts, toys, bottles, bags.
   Look at each result. If rembg cannot download its model or a cut-out is clearly wrong, leave that photo out and report it.
   Never publish a photo with the original shop background.
5. School photo: save to assets/uniforms/<slug>/<name>.webp, add {"file","caption"} to that school's uniformPhotos in data/schools.json.
   Section photo: save to assets/gallery/<section-slug>/<name>.webp, add {"file","caption","group"} to that section's `photos`
   in data/sections.json (`group` = product-type subfolder name; leave it out if the photo is straight in the section folder).
   A section page, its home-page "See photos" link and its sitemap entry appear automatically once it has a photo.
   File names: lower-case words with dashes, .webp. Caption = the item in plain words, e.g. "Navy blue blazer (winter)".
   Never put a price in a caption, never claim delivery.
6. Record each processed Drive file id in data/processed-photos.json (also for photos you left out on purpose, with a note in the PR).
7. `npm run build && npm test` (all must pass).
8. Push a NEW branch and open a pull request. DO NOT MERGE. The owner approves first.
9. Tell the owner which photos were added where, and anything that needs a decision.
