#!/bin/bash
ARENA="https://political-arena.rblake2320.workers.dev"
PY="C:/Python312/python.exe"
DIR="C:/Users/techai/Desktop/arena-deploy"

# Tokens (beta1 is super_admin, can grant credits)
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

# All candidate IDs
CANDIDATES=(
  "cand-1" "cand-2" "cand-3" "cand-4" "cand-5" "cand-6"
  "cand_mlzwqajl1j0o3v0b1x"
  "cand_mlzwsung4k4t0z3q60"
  "cand_mlzwsv4o2d0x05481k"
  "cand_mlzwsvmp5q0c5e0s6b"
  "cand_mlzwsw7l1m6m3l2w2q"
  "cand_mlzwswql0m1u0g5z07"
  "cand_mlzwsx8q3z3q453541"
  "cand_mlzwsxom3h21615y5i"
  "cand_mlzwsy3l5g0o5d4t0o"
  "cand_mlzwsylb3x6w5t1a31"
)

# Grant 50 credits to every candidate
echo "=== Granting 50 credits to all candidates ==="
for CAND_ID in "${CANDIDATES[@]}"; do
  RESULT=$(curl -s -X POST "$ARENA/api/credits/$CAND_ID/grant" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN1" \
    -d '{"amount":50,"description":"Beta testing credits"}')
  BAL=$(echo "$RESULT" | $PY -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('credit_balance','ERR'))" 2>/dev/null)
  echo "  $CAND_ID: balance=$BAL"
done

echo ""

# Candidate mapping
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

# === CHALLENGE 1: FL - Mitchell (D) challenges Rivera (R) on immigration ===
echo "=== Challenge 1: FL - Mitchell vs Rivera ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN1" \
  -d '{"race_id":"'"$RACE4"'","challenger_candidate_id":"'"$CAND7"'","target_candidate_id":"'"$CAND8"'","challenge_text":"Carlos Rivera, you claim to support immigration reform but your company used H-1B visa workers while laying off Florida residents. How can voters trust your border security platform when you personally profited from the system you criticize?","challenge_type":"fact_check","deadline_business_days":3}' \
  -o "$DIR/ch_fl1.json"
cat "$DIR/ch_fl1.json"; echo

# === CHALLENGE 2: OH - Foster (R) challenges Park (D) on opioid money ===
echo ""
echo "=== Challenge 2: OH - Foster vs Park ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN4" \
  -d '{"race_id":"'"$RACE5"'","challenger_candidate_id":"'"$CAND10"'","target_candidate_id":"'"$CAND9"'","challenge_text":"David Park, you recovered 2 billion in opioid settlements as AG, but Ohio overdose deaths INCREASED 15 percent during your tenure. Where did that money actually go? Can you show voters a single treatment center built with those funds?","challenge_type":"fact_check","deadline_business_days":5}' \
  -o "$DIR/ch_oh1.json"
cat "$DIR/ch_oh1.json"; echo

# === CHALLENGE 3: GA - Sharma (D) challenges Bradley (R) on broadband ===
echo ""
echo "=== Challenge 3: GA - Sharma vs Bradley ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN5" \
  -d '{"race_id":"'"$RACE6"'","challenger_candidate_id":"'"$CAND11"'","target_candidate_id":"'"$CAND12"'","challenge_text":"Tom Bradley, you voted against the Georgia Broadband Act that would have brought high-speed internet to 50,000 homes in our district. As a veteran, how do you justify blocking rural families and telehealth access for veterans?","challenge_type":"debate_request","deadline_business_days":3}' \
  -o "$DIR/ch_ga1.json"
cat "$DIR/ch_ga1.json"; echo

# === CHALLENGE 4: NV - Morrison (R) challenges Espinoza (D) on water ===
echo ""
echo "=== Challenge 4: NV - Morrison vs Espinoza ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN8" \
  -d '{"race_id":"'"$RACE7"'","challenger_candidate_id":"'"$CAND14"'","target_candidate_id":"'"$CAND13"'","challenge_text":"Rosa Espinoza, your union blocked the Lake Mead desalination project that would have secured water for 2 million Nevadans. The Colorado River is drying up. What is your actual plan to keep water flowing to Las Vegas?","challenge_type":"policy_question","deadline_business_days":5}' \
  -o "$DIR/ch_nv1.json"
cat "$DIR/ch_nv1.json"; echo

# === CHALLENGE 5: PA - Chen (D) challenges Anderson (R) on energy ===
echo ""
echo "=== Challenge 5: PA - Chen vs Anderson ==="
curl -s -X POST "$ARENA/api/challenges" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN9" \
  -d '{"race_id":"'"$RACE8"'","challenger_candidate_id":"'"$CAND15"'","target_candidate_id":"'"$CAND16"'","challenge_text":"Kelly Anderson, you say you support energy independence but your top 5 donors are all fracking companies. Pennsylvania families are paying record heating bills while these companies post record profits. Will you commit to a windfall profits tax to fund home heating assistance?","challenge_type":"policy_question","deadline_business_days":3}' \
  -o "$DIR/ch_pa1.json"
cat "$DIR/ch_pa1.json"; echo

echo ""
echo "=== NOW RESPONDING TO CHALLENGES ==="
sleep 1

# Rivera responds to Mitchell (FL)
CH_FL=$($PY -c "import json; d=json.load(open('$DIR/ch_fl1.json')); print(d.get('data',{}).get('challenge_id','NONE'))" 2>/dev/null)
echo ""
echo "--- FL Response (Rivera) [$CH_FL] ---"
if [ "$CH_FL" != "NONE" ] && [ -n "$CH_FL" ]; then
  curl -s -X POST "$ARENA/api/challenges/$CH_FL/respond" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN2" \
    -d '{"response_text":"Sarah Mitchell is desperate. My company hired H-1B workers in specialized AI roles where no Florida candidates applied. I created 2,000+ LOCAL jobs paying above median wage. Meanwhile, Mitchell raised property taxes 3 times as Miami-Dade mayor. The facts speak for themselves."}'
  echo
fi

# Park responds to Foster (OH)
CH_OH=$($PY -c "import json; d=json.load(open('$DIR/ch_oh1.json')); print(d.get('data',{}).get('challenge_id','NONE'))" 2>/dev/null)
echo "--- OH Response (Park) [$CH_OH] ---"
if [ "$CH_OH" != "NONE" ] && [ -n "$CH_OH" ]; then
  curl -s -X POST "$ARENA/api/challenges/$CH_OH/respond" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN3" \
    -d '{"response_text":"Amanda Foster knows where the money went. I published quarterly reports. 847M to treatment centers, 312M to naloxone, 200M to school prevention. Deaths increased NATIONALLY. Ohio actually performed better than the national average. I will debate these facts anywhere, anytime."}'
  echo
fi

# Espinoza responds to Morrison (NV)
CH_NV=$($PY -c "import json; d=json.load(open('$DIR/ch_nv1.json')); print(d.get('data',{}).get('challenge_id','NONE'))" 2>/dev/null)
echo "--- NV Response (Espinoza) [$CH_NV] ---"
if [ "$CH_NV" != "NONE" ] && [ -n "$CH_NV" ]; then
  curl -s -X POST "$ARENA/api/challenges/$CH_NV/respond" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN7" \
    -d '{"response_text":"Jakes casinos use 800 million gallons per year on fountains and golf courses. My plan: mandatory 20 percent water recycling for buildings over 50K sqft, 500M for desalination funded by tourism taxes, and Colorado River compact renegotiation. Real solutions, not billionaire talking points."}'
  echo
fi

echo ""
echo "=== VOTER REACTIONS ==="

# Reactions on challenges
if [ "$CH_FL" != "NONE" ] && [ -n "$CH_FL" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
    -d '{"content_type":"challenge","content_id":"'"$CH_FL"'","reaction_type":"important"}' > /dev/null 2>&1
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
    -d '{"content_type":"challenge","content_id":"'"$CH_FL"'","reaction_type":"helpful"}' > /dev/null 2>&1
  echo "FL challenge: 2 reactions"
fi

if [ "$CH_OH" != "NONE" ] && [ -n "$CH_OH" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
    -d '{"content_type":"challenge","content_id":"'"$CH_OH"'","reaction_type":"important"}' > /dev/null 2>&1
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
    -d '{"content_type":"challenge","content_id":"'"$CH_OH"'","reaction_type":"misleading"}' > /dev/null 2>&1
  echo "OH challenge: 2 reactions"
fi

if [ "$CH_NV" != "NONE" ] && [ -n "$CH_NV" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
    -d '{"content_type":"challenge","content_id":"'"$CH_NV"'","reaction_type":"agree"}' > /dev/null 2>&1
  echo "NV challenge: 1 reaction"
fi

echo ""
echo "=== COMPLETE ==="
echo "Created:"
echo "  - Credits granted to 16 candidates"
echo "  - 5 challenges (3 responded, 2 open)"
echo "  - 4 ads"
echo "  - 5+ voter reactions"
