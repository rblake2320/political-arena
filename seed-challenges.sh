#!/bin/bash
ARENA="https://political-arena.rblake2320.workers.dev"
PY="C:/Python312/python.exe"
DIR="C:/Users/techai/Desktop/arena-deploy"

# Tokens
TOKEN1=$($PY -c "import json; print(json.load(open('$DIR/beta1.json'))['data']['token'])")
TOKEN2=$($PY -c "import json; print(json.load(open('$DIR/beta2.json'))['data']['token'])")
TOKEN3=$($PY -c "import json; print(json.load(open('$DIR/beta3.json'))['data']['token'])")
TOKEN4=$($PY -c "import json; print(json.load(open('$DIR/beta4.json'))['data']['token'])")
TOKEN5=$($PY -c "import json; print(json.load(open('$DIR/beta5.json'))['data']['token'])")
TOKEN6=$($PY -c "import json; print(json.load(open('$DIR/beta6.json'))['data']['token'])")
TOKEN7=$($PY -c "import json; print(json.load(open('$DIR/beta7.json'))['data']['token'])")
TOKEN8=$($PY -c "import json; print(json.load(open('$DIR/beta8.json'))['data']['token'])")
TOKEN9=$($PY -c "import json; print(json.load(open('$DIR/beta9.json'))['data']['token'])")
TOKEN10=$($PY -c "import json; print(json.load(open('$DIR/beta10.json'))['data']['token'])")
TOKEN11=$($PY -c "import json; print(json.load(open('$DIR/beta11.json'))['data']['token'])")
TOKEN12=$($PY -c "import json; print(json.load(open('$DIR/beta12.json'))['data']['token'])")

# Candidate IDs
CAND7="cand_mlzwqajl1j0o3v0b1x"  # Sarah Mitchell (FL D) - beta1
CAND8="cand_mlzwsung4k4t0z3q60"  # Carlos Rivera (FL R) - beta2
CAND9="cand_mlzwsv4o2d0x05481k"  # David Park (OH D) - beta3
CAND10="cand_mlzwsvmp5q0c5e0s6b" # Amanda Foster (OH R) - beta4
CAND11="cand_mlzwsw7l1m6m3l2w2q" # Priya Sharma (GA D) - beta5
CAND12="cand_mlzwswql0m1u0g5z07" # Tom Bradley (GA R) - beta6
CAND13="cand_mlzwsx8q3z3q453541" # Rosa Espinoza (NV D) - beta7
CAND14="cand_mlzwsxom3h21615y5i" # Jake Morrison (NV R) - beta8
CAND15="cand_mlzwsy3l5g0o5d4t0o" # Michael Chen (PA D) - beta9
CAND16="cand_mlzwsylb3x6w5t1a31" # Kelly Anderson (PA R) - beta10

RACE4="race_mlzwoj2p0c3t0g093h"  # Florida Senate
RACE5="race_mlzwojiq250302353c"  # Ohio Governor
RACE6="race_mlzwojwp6e3s4l0l3g"  # Georgia 6th
RACE7="race_mlzwok9k1v6v2i1j5x"  # Nevada Senate
RACE8="race_mlzwoko93p1n362u0b"  # PA Governor

# First grant credits to all beta users so they can issue challenges
echo "=== Granting credits ==="
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  TVAR="TOKEN$i"
  TK="${!TVAR}"
  # Admin self-grant (super_admin can do this)
  curl -s -X POST "$ARENA/api/credits/grant" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TK" \
    -d '{"amount":50,"description":"Beta testing credits"}' > /dev/null
done
echo "Credits granted to 12 beta users"

# === FLORIDA: Mitchell (D) challenges Rivera (R) ===
echo ""
echo "=== Challenge 1: FL - Mitchell challenges Rivera on immigration ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN1" \
  -d '{"race_id":"'"$RACE4"'","challenger_candidate_id":"'"$CAND7"'","target_candidate_id":"'"$CAND8"'","challenge_text":"Carlos Rivera, you claim to support immigration reform but your company used H-1B visa workers while laying off Florida residents. How can voters trust your border security platform when you personally profited from the system you criticize?","challenge_type":"fact_check","deadline_business_days":3}' \
  -o "$DIR/ch_fl1.json"
cat "$DIR/ch_fl1.json"; echo

# === OHIO: Foster (R) challenges Park (D) ===
echo ""
echo "=== Challenge 2: OH - Foster challenges Park on opioid settlement money ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN4" \
  -d '{"race_id":"'"$RACE5"'","challenger_candidate_id":"'"$CAND10"'","target_candidate_id":"'"$CAND9"'","challenge_text":"David Park, you recovered 2 billion in opioid settlements as AG, but Ohio overdose deaths INCREASED 15 percent during your tenure. Where did that money actually go? Can you show voters a single treatment center built with those funds?","challenge_type":"fact_check","deadline_business_days":5}' \
  -o "$DIR/ch_oh1.json"
cat "$DIR/ch_oh1.json"; echo

# === GEORGIA: Sharma (D) challenges Bradley (R) ===
echo ""
echo "=== Challenge 3: GA - Sharma challenges Bradley on tech jobs ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN5" \
  -d '{"race_id":"'"$RACE6"'","challenger_candidate_id":"'"$CAND11"'","target_candidate_id":"'"$CAND12"'","challenge_text":"Tom Bradley, you voted against the Georgia Broadband Act that would have brought high-speed internet to 50,000 homes in our district. As a veteran, how do you justify blocking rural families and telehealth access for veterans?","challenge_type":"debate_request","deadline_business_days":3}' \
  -o "$DIR/ch_ga1.json"
cat "$DIR/ch_ga1.json"; echo

# === NEVADA: Morrison (R) challenges Espinoza (D) ===
echo ""
echo "=== Challenge 4: NV - Morrison challenges Espinoza on water ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN8" \
  -d '{"race_id":"'"$RACE7"'","challenger_candidate_id":"'"$CAND14"'","target_candidate_id":"'"$CAND13"'","challenge_text":"Rosa Espinoza, your union blocked the Lake Mead desalination project that would have secured water for 2 million Nevadans. The Colorado River is drying up. What is your actual plan to keep water flowing to Las Vegas — not union talking points, but real infrastructure?","challenge_type":"policy_question","deadline_business_days":5}' \
  -o "$DIR/ch_nv1.json"
cat "$DIR/ch_nv1.json"; echo

# === PA: Chen (D) challenges Anderson (R) ===
echo ""
echo "=== Challenge 5: PA - Chen challenges Anderson on energy ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN9" \
  -d '{"race_id":"'"$RACE8"'","challenger_candidate_id":"'"$CAND15"'","target_candidate_id":"'"$CAND16"'","challenge_text":"Kelly Anderson, you say you support energy independence but your top 5 donors are all fracking companies. Pennsylvania families are paying record heating bills while these companies post record profits. Will you commit to a windfall profits tax to fund home heating assistance?","challenge_type":"policy_question","deadline_business_days":3}' \
  -o "$DIR/ch_pa1.json"
cat "$DIR/ch_pa1.json"; echo

echo ""
echo "=== ALL 5 NEW CHALLENGES CREATED ==="
echo ""

# Now RESPOND to some challenges immediately
sleep 2

# Florida: Rivera responds
echo "=== Response 1: Rivera responds to Mitchell ==="
CH_FL=$($PY -c "import json; d=json.load(open('$DIR/ch_fl1.json')); print(d.get('data',{}).get('challenge_id','NONE'))")
if [ "$CH_FL" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/challenges/$CH_FL/respond" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN2" \
    -d '{"response_text":"Sarah Mitchell is desperate and misleading voters. My company hired H-1B workers in specialized AI roles — jobs no Florida candidates applied for. I created 2,000+ LOCAL jobs paying above median wage. Meanwhile, Mitchell raised property taxes 3 times as Miami-Dade mayor. The facts speak for themselves."}'
  echo
fi

# Ohio: Park responds
echo ""
echo "=== Response 2: Park responds to Foster ==="
CH_OH=$($PY -c "import json; d=json.load(open('$DIR/ch_oh1.json')); print(d.get('data',{}).get('challenge_id','NONE'))")
if [ "$CH_OH" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/challenges/$CH_OH/respond" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN3" \
    -d '{"response_text":"Amanda Foster knows exactly where the money went — I published quarterly reports the entire time. 847 million went to treatment centers, 312 million to first responder naloxone supplies, and 200 million to school prevention programs. Overdose deaths increased NATIONALLY during that period. Ohio actually performed better than the national average. I will debate these facts anywhere, anytime."}'
  echo
fi

# Nevada: Espinoza responds
echo ""
echo "=== Response 3: Espinoza responds to Morrison ==="
CH_NV=$($PY -c "import json; d=json.load(open('$DIR/ch_nv1.json')); print(d.get('data',{}).get('challenge_id','NONE'))")
if [ "$CH_NV" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/challenges/$CH_NV/respond" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN7" \
    -d '{"response_text":"Jake Morrison is the last person who should lecture anyone about water. His casinos use 800 million gallons per year on decorative fountains and golf courses. My plan: mandatory 20 percent water recycling for commercial buildings over 50,000 sqft, 500 million for desalination funded by tourism taxes — not working family taxes — and joining the Colorado River compact renegotiation. Real solutions, not casino billionaire talking points."}'
  echo
fi

echo ""
echo "=== 3 OF 5 CHALLENGES RESPONDED ==="
echo "(GA and PA challenges left OPEN for back-and-forth)"

# === Now create some ADS ===
echo ""
echo "=== Creating Ads ==="

# Florida ad by Mitchell
echo "--- FL Ad: Mitchell campaign ad ---"
curl -s -X POST "$ARENA/api/ads" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN1" \
  -d '{"race_id":"'"$RACE4"'","candidate_id":"'"$CAND7"'","title":"Sarah Mitchell: Real Leadership for Florida","ad_content_text":"While my opponent was laying off Florida workers and hiring overseas, I was fighting for affordable housing and hurricane resilience as your Mayor. Florida deserves a Senator who puts our families first — not corporate profits. Join our campaign.","disclaimer_text":"Paid for by Mitchell for Florida 2026","media_type":"text","budget_cents":5000}' \
  -o "$DIR/ad_fl1.json"
cat "$DIR/ad_fl1.json"; echo

# Ohio ad by Foster
echo "--- OH Ad: Foster campaign ad ---"
curl -s -X POST "$ARENA/api/ads" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN4" \
  -d '{"race_id":"'"$RACE5"'","candidate_id":"'"$CAND10"'","title":"Amanda Foster: Ohio Works Because We Work","ad_content_text":"50,000 new apprenticeships. 200 factories reopened. Real jobs, not government handouts. As Lt. Governor, I brought manufacturing BACK to Ohio. As Governor, I will finish the job. Ohio works because WE work.","disclaimer_text":"Paid for by Foster for Governor 2026","media_type":"text","budget_cents":10000}' \
  -o "$DIR/ad_oh1.json"
cat "$DIR/ad_oh1.json"; echo

# Georgia ad by Bradley
echo "--- GA Ad: Bradley campaign ad ---"
curl -s -X POST "$ARENA/api/ads" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN6" \
  -d '{"race_id":"'"$RACE6"'","candidate_id":"'"$CAND12"'","title":"Tom Bradley: A Veteran for GA-6","ad_content_text":"I served 20 years defending this country. Then I came home and built a business employing 200 of my neighbors. My opponent is a Silicon Valley transplant who thinks she knows what Georgia families need. I LIVE it. Vote Bradley — the real deal.","disclaimer_text":"Paid for by Bradley for Congress","media_type":"text","budget_cents":3000}' \
  -o "$DIR/ad_ga1.json"
cat "$DIR/ad_ga1.json"; echo

# PA ad by Chen
echo "--- PA Ad: Chen campaign ad ---"
curl -s -X POST "$ARENA/api/ads" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN9" \
  -d '{"race_id":"'"$RACE8"'","candidate_id":"'"$CAND15"'","title":"Michael Chen: Justice for All Pennsylvanians","ad_content_text":"As DA, I cut violent crime 15 percent while reducing incarceration 20 percent. Smart justice, not tough talk. As Governor, I will bring that same approach to every challenge — energy policy that works for workers AND the environment, schools that prepare kids for the future, and healthcare that covers every family. Pennsylvania Forward.","disclaimer_text":"Paid for by Chen for Governor PA","media_type":"text","budget_cents":8000}' \
  -o "$DIR/ad_pa1.json"
cat "$DIR/ad_pa1.json"; echo

echo "=== ALL ADS CREATED ==="

# === REACTIONS from voters (beta11, beta12) ===
echo ""
echo "=== Voter Reactions ==="

# Get ad IDs
AD_FL=$($PY -c "import json; d=json.load(open('$DIR/ad_fl1.json')); print(d.get('data',{}).get('id','NONE'))")
AD_OH=$($PY -c "import json; d=json.load(open('$DIR/ad_oh1.json')); print(d.get('data',{}).get('id','NONE'))")
AD_GA=$($PY -c "import json; d=json.load(open('$DIR/ad_ga1.json')); print(d.get('data',{}).get('id','NONE'))")
AD_PA=$($PY -c "import json; d=json.load(open('$DIR/ad_pa1.json')); print(d.get('data',{}).get('id','NONE'))")

echo "Ad IDs: FL=$AD_FL, OH=$AD_OH, GA=$AD_GA, PA=$AD_PA"

# Reactions on FL ad
if [ "$AD_FL" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
    -d '{"content_type":"ad","content_id":"'"$AD_FL"'","reaction_type":"helpful"}' > /dev/null
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
    -d '{"content_type":"ad","content_id":"'"$AD_FL"'","reaction_type":"agree"}' > /dev/null
  echo "FL ad: 2 reactions"
fi

# Reactions on challenges
if [ "$CH_FL" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
    -d '{"content_type":"challenge","content_id":"'"$CH_FL"'","reaction_type":"important"}' > /dev/null
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
    -d '{"content_type":"challenge","content_id":"'"$CH_FL"'","reaction_type":"helpful"}' > /dev/null
  echo "FL challenge: 2 reactions"
fi

if [ "$CH_OH" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
    -d '{"content_type":"challenge","content_id":"'"$CH_OH"'","reaction_type":"important"}' > /dev/null
  echo "OH challenge: 1 reaction"
fi

if [ "$CH_NV" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
    -d '{"content_type":"challenge","content_id":"'"$CH_NV"'","reaction_type":"agree"}' > /dev/null
  echo "NV challenge: 1 reaction"
fi

# Reactions on challenge responses
curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
  -d '{"content_type":"challenge_response","content_id":"'"$CH_FL"'","reaction_type":"misleading"}' > /dev/null 2>&1
curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
  -d '{"content_type":"challenge_response","content_id":"'"$CH_OH"'","reaction_type":"helpful"}' > /dev/null 2>&1
echo "Challenge responses: 2 reactions"

echo ""
echo "=== ALL ACTIVITY CREATED ==="
echo "Summary:"
echo "  - 5 new races (FL, OH, GA, NV, PA)"
echo "  - 10 new candidates"
echo "  - 5 new challenges (3 responded, 2 open)"
echo "  - 4 campaign ads"
echo "  - 8+ voter reactions"
