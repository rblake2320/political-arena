#!/bin/bash
ARENA="https://political-arena.rblake2320.workers.dev"
PY="C:/Python312/python.exe"
DIR="C:/Users/techai/Desktop/arena-deploy"

# Login more betas
for i in 5 6 7 8 9 10 11 12; do
  curl -s -X POST "$ARENA/api/auth/login" -H "Content-Type: application/json" \
    -d "{\"email\":\"beta${i}@arena.test\",\"password\":\"Arena2026!\"}" \
    -o "$DIR/beta${i}.json"
done

# Extract all tokens
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

echo "All 12 tokens acquired"

RACE4="race_mlzwoj2p0c3t0g093h"
RACE5="race_mlzwojiq250302353c"
RACE6="race_mlzwojwp6e3s4l0l3g"
RACE7="race_mlzwok9k1v6v2i1j5x"
RACE8="race_mlzwoko93p1n362u0b"

# Florida R candidate (beta2)
echo "--- Florida R candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN2" \
  -d '{"race_id":"'"$RACE4"'","name":"Carlos Rivera","party":"Republican","biography":"Tech entrepreneur and state senator. Founded 3 companies creating 2000+ jobs.","issue_positions":["Border security","Tax cuts","Business growth","School choice","Veterans"],"website_url":"https://riveraforsenate.com"}' \
  -o "$DIR/cand8.json"
cat "$DIR/cand8.json"; echo

# Ohio D candidate (beta3)
echo "--- Ohio D candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN3" \
  -d '{"race_id":"'"$RACE5"'","name":"David Park","party":"Democrat","biography":"Former Ohio AG. Prosecuted opioid distributors and recovered 2B in settlements.","issue_positions":["Opioid crisis","Manufacturing","Education","Healthcare","Clean energy"],"website_url":"https://parkforohio.com"}' \
  -o "$DIR/cand9.json"
cat "$DIR/cand9.json"; echo

# Ohio R candidate (beta4)
echo "--- Ohio R candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN4" \
  -d '{"race_id":"'"$RACE5"'","name":"Amanda Foster","party":"Republican","biography":"Current Lt. Governor. Led workforce development adding 50000 apprenticeships.","issue_positions":["Manufacturing","School choice","Tax reform","Law enforcement","Small business"],"website_url":"https://fosterforgovernor.com"}' \
  -o "$DIR/cand10.json"
cat "$DIR/cand10.json"; echo

# Georgia D candidate (beta5)
echo "--- Georgia D candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN5" \
  -d '{"race_id":"'"$RACE6"'","name":"Priya Sharma","party":"Democrat","biography":"Former Google engineer turned community organizer. Connected 10000 residents to broadband.","issue_positions":["Tech economy","Transportation","Healthcare","Education","Climate"],"website_url":"https://sharmaforga6.com"}' \
  -o "$DIR/cand11.json"
cat "$DIR/cand11.json"; echo

# Georgia R candidate (beta6)
echo "--- Georgia R candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN6" \
  -d '{"race_id":"'"$RACE6"'","name":"Tom Bradley","party":"Republican","biography":"Small business owner and Army veteran. Runs auto repair shops employing 200+ workers.","issue_positions":["Small business","Tax cuts","Law enforcement","Immigration","Education"],"website_url":"https://bradleyforga6.com"}' \
  -o "$DIR/cand12.json"
cat "$DIR/cand12.json"; echo

# Nevada D candidate (beta7)
echo "--- Nevada D candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN7" \
  -d '{"race_id":"'"$RACE7"'","name":"Rosa Espinoza","party":"Democrat","biography":"Culinary Workers Union leader. Negotiated healthcare for 60000 Las Vegas hotel workers.","issue_positions":["Worker rights","Housing","Water conservation","Healthcare","Immigration"],"website_url":"https://espinozafornevada.com"}' \
  -o "$DIR/cand13.json"
cat "$DIR/cand13.json"; echo

# Nevada R candidate (beta8)
echo "--- Nevada R candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN8" \
  -d '{"race_id":"'"$RACE7"'","name":"Jake Morrison","party":"Republican","biography":"Casino executive turned politician. Built 3 major resorts creating 15000 jobs.","issue_positions":["Economic growth","Water rights","Tax cuts","Border security","Energy independence"],"website_url":"https://morrisonfornevada.com"}' \
  -o "$DIR/cand14.json"
cat "$DIR/cand14.json"; echo

# PA D candidate (beta9)
echo "--- PA D candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN9" \
  -d '{"race_id":"'"$RACE8"'","name":"Michael Chen","party":"Democrat","biography":"Former Philadelphia DA. Led criminal justice reform reducing incarceration 20 percent.","issue_positions":["Criminal justice","Energy policy","Education","Healthcare","Rural broadband"],"website_url":"https://chenforpa.com"}' \
  -o "$DIR/cand15.json"
cat "$DIR/cand15.json"; echo

# PA R candidate (beta10)
echo "--- PA R candidate ---"
curl -s -X POST "$ARENA/api/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN10" \
  -d '{"race_id":"'"$RACE8"'","name":"Kelly Anderson","party":"Republican","biography":"State senator from Erie. Former steelworker who built manufacturing coalition.","issue_positions":["Manufacturing","Energy independence","Tax reform","Gun rights","School choice"],"website_url":"https://andersonforpa.com"}' \
  -o "$DIR/cand16.json"
cat "$DIR/cand16.json"; echo

echo "=== ALL CANDIDATES DONE ==="
