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

# Extract challenge IDs from json files (key is "id" not "challenge_id")
CH_FL=$($PY -c "import json; d=json.load(open('$DIR/ch_fl1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)
CH_OH=$($PY -c "import json; d=json.load(open('$DIR/ch_oh1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)
CH_GA=$($PY -c "import json; d=json.load(open('$DIR/ch_ga1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)
CH_NV=$($PY -c "import json; d=json.load(open('$DIR/ch_nv1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)
CH_PA=$($PY -c "import json; d=json.load(open('$DIR/ch_pa1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)

echo "Challenge IDs:"
echo "  FL: $CH_FL"
echo "  OH: $CH_OH"
echo "  GA: $CH_GA"
echo "  NV: $CH_NV"
echo "  PA: $CH_PA"

# === RESPONSES ===

# Rivera (FL R, beta2) responds to Mitchell's challenge
echo ""
echo "=== FL: Rivera responds ==="
curl -s -X POST "$ARENA/api/challenges/$CH_FL/respond" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN2" \
  -d '{"response_text":"Sarah Mitchell is desperate and misleading voters. My company hired H-1B workers in specialized AI roles that no Florida candidates applied for. I created 2,000+ LOCAL jobs paying above median wage. Meanwhile, Mitchell raised property taxes 3 times as Miami-Dade mayor. I challenge her to release her full tax record."}'
echo ""

# Park (OH D, beta3) responds to Foster's challenge
echo ""
echo "=== OH: Park responds ==="
curl -s -X POST "$ARENA/api/challenges/$CH_OH/respond" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN3" \
  -d '{"response_text":"Amanda Foster knows exactly where the money went. I published quarterly reports for 4 years straight. 847 million went to 23 new treatment centers. 312 million to first responder naloxone supplies saving 40,000 lives. 200 million to school prevention programs reaching 500,000 students. Overdose deaths increased NATIONALLY during that period. Ohio performed BETTER than the national average. Happy to debate these facts anywhere, anytime."}'
echo ""

# Bradley (GA R, beta6) responds to Sharma's challenge
echo ""
echo "=== GA: Bradley responds ==="
curl -s -X POST "$ARENA/api/challenges/$CH_GA/respond" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN6" \
  -d '{"response_text":"I did not vote against broadband. I voted against a 2 BILLION dollar boondoggle that would have taken 8 years to deploy. My alternative bill funded private-public partnerships that are already connecting 30,000 homes at HALF the cost. Priya Sharma can give Silicon Valley speeches all day long. I deliver results. And as a veteran, I do not need lectures about serving my community from someone who just moved here from California."}'
echo ""

# Espinoza (NV D, beta7) responds to Morrison's challenge
echo ""
echo "=== NV: Espinoza responds ==="
curl -s -X POST "$ARENA/api/challenges/$CH_NV/respond" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN7" \
  -d '{"response_text":"Jakes casinos use 800 million gallons per year on decorative fountains and golf courses while families ration water. My plan: mandatory 20 percent water recycling for commercial buildings over 50,000 sqft, 500 million for desalination funded by tourism taxes not working family taxes, and joining the Colorado River compact renegotiation as lead negotiator. Real solutions from someone who actually represents working Nevadans."}'
echo ""

# Anderson (PA R, beta10) responds to Chen's challenge
echo ""
echo "=== PA: Anderson responds ==="
curl -s -X POST "$ARENA/api/challenges/$CH_PA/respond" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN10" \
  -d '{"response_text":"Michael Chen wants to punish the industry that keeps Pennsylvania families warm in winter. A windfall profits tax would drive energy companies to Texas and Ohio, costing us 50,000 jobs. My plan: 200 million in direct heating assistance funded by existing severance taxes, plus a new nuclear energy initiative that creates 10,000 permanent jobs. That is real energy independence, not anti-business grandstanding from a Philadelphia lawyer."}'
echo ""

echo ""
echo "=== ALL 5 CHALLENGES RESPONDED ==="

# === Now add VOTER REACTIONS to everything ===
echo ""
echo "=== Adding voter reactions ==="

# Reactions on challenges (beta11 and beta12 as voters)
curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
  -d '{"content_type":"challenge","content_id":"'"$CH_FL"'","reaction_type":"important"}' > /dev/null 2>&1
curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
  -d '{"content_type":"challenge","content_id":"'"$CH_FL"'","reaction_type":"helpful"}' > /dev/null 2>&1

curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
  -d '{"content_type":"challenge","content_id":"'"$CH_OH"'","reaction_type":"important"}' > /dev/null 2>&1
curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
  -d '{"content_type":"challenge","content_id":"'"$CH_OH"'","reaction_type":"misleading"}' > /dev/null 2>&1

curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
  -d '{"content_type":"challenge","content_id":"'"$CH_GA"'","reaction_type":"agree"}' > /dev/null 2>&1
curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
  -d '{"content_type":"challenge","content_id":"'"$CH_GA"'","reaction_type":"important"}' > /dev/null 2>&1

curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
  -d '{"content_type":"challenge","content_id":"'"$CH_NV"'","reaction_type":"helpful"}' > /dev/null 2>&1
curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
  -d '{"content_type":"challenge","content_id":"'"$CH_NV"'","reaction_type":"agree"}' > /dev/null 2>&1

curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
  -d '{"content_type":"challenge","content_id":"'"$CH_PA"'","reaction_type":"important"}' > /dev/null 2>&1
curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
  -d '{"content_type":"challenge","content_id":"'"$CH_PA"'","reaction_type":"disagree"}' > /dev/null 2>&1

echo "10 challenge reactions added"

# Reactions on ads
AD_FL=$($PY -c "import json; d=json.load(open('$DIR/ad_fl1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)
AD_OH=$($PY -c "import json; d=json.load(open('$DIR/ad_oh1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)
AD_GA=$($PY -c "import json; d=json.load(open('$DIR/ad_ga1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)
AD_PA=$($PY -c "import json; d=json.load(open('$DIR/ad_pa1.json')); print(d.get('data',{}).get('id','NONE'))" 2>/dev/null)

if [ "$AD_FL" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
    -d '{"content_type":"ad","content_id":"'"$AD_FL"'","reaction_type":"helpful"}' > /dev/null 2>&1
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
    -d '{"content_type":"ad","content_id":"'"$AD_FL"'","reaction_type":"agree"}' > /dev/null 2>&1
  echo "FL ad: 2 reactions"
fi
if [ "$AD_OH" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN11" \
    -d '{"content_type":"ad","content_id":"'"$AD_OH"'","reaction_type":"misleading"}' > /dev/null 2>&1
  echo "OH ad: 1 reaction"
fi
if [ "$AD_GA" != "NONE" ]; then
  curl -s -X POST "$ARENA/api/reactions" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN12" \
    -d '{"content_type":"ad","content_id":"'"$AD_GA"'","reaction_type":"disagree"}' > /dev/null 2>&1
  echo "GA ad: 1 reaction"
fi

# === Submit voter questions ===
echo ""
echo "=== Submitting voter questions ==="

# Voter question for Florida race
curl -s -X POST "$ARENA/api/questions/races/$RACE4" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN11" \
  -d '{"source_type":"voter","question_text":"Both candidates - what specific legislation will you introduce in the first 100 days to address Floridas property insurance crisis? Premiums have tripled in 3 years."}' > /dev/null 2>&1
echo "FL voter question submitted"

RACE4="race_mlzwoj2p0c3t0g093h"
RACE5="race_mlzwojiq250302353c"
RACE7="race_mlzwok9k1v6v2i1j5x"

# Voter question for Ohio race
curl -s -X POST "$ARENA/api/questions/races/$RACE5" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN12" \
  -d '{"source_type":"voter","question_text":"The opioid crisis has personally affected my family. What will you do differently from the current governor to actually reduce overdose deaths, not just settle lawsuits?"}' > /dev/null 2>&1
echo "OH voter question submitted"

# Press question for Nevada race
curl -s -X POST "$ARENA/api/questions/races/$RACE7" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN11" \
  -d '{"source_type":"press","question_text":"Lake Mead is at 27 percent capacity. The Bureau of Reclamation projects it could reach dead pool by 2028. Both candidates have water plans - what is the timeline for each plan to deliver actual water to residents?"}' > /dev/null 2>&1
echo "NV press question submitted"

echo ""
echo "=== ALL ACTIVITY COMPLETE ==="
echo "Summary:"
echo "  - 5 challenges created and ALL 5 responded"
echo "  - 4 campaign ads"
echo "  - 14+ voter reactions (challenges + ads)"
echo "  - 3 voter/press questions"
