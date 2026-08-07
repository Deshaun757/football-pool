import { Router } from 'express';
import { z } from 'zod';

const colors: Record<string,string> = { ARI:'#97233f',ATL:'#a71930',BAL:'#241773',BUF:'#00338d',CAR:'#0085ca',CHI:'#0b162a',CIN:'#fb4f14',CLE:'#311d00',DAL:'#003594',DEN:'#fb4f14',DET:'#0076b6',GB:'#203731',HOU:'#03202f',IND:'#002c5f',JAX:'#006778',KC:'#e31837',LV:'#000000',LAC:'#0080c6',LA:'#003594',MIA:'#008e97',MIN:'#4f2683',NE:'#002244',NO:'#d3bc8d',NYG:'#0b2265',NYJ:'#125740',PHI:'#004c54',PIT:'#ffb612',SEA:'#002244',SF:'#aa0000',TB:'#d50a0a',TEN:'#0c2340',WAS:'#5a1414' };
export const teamBadgesRouter = Router();
teamBadgesRouter.get('/:abbr.svg', (request, response) => {
  const abbr = z.string().regex(/^[A-Z]{2,3}$/).parse(request.params.abbr);
  const color = colors[abbr] ?? '#154f36';
  response.type('image/svg+xml').set('Cache-Control','public, max-age=86400').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${abbr}"><circle cx="50" cy="50" r="47" fill="${color}"/><circle cx="50" cy="50" r="41" fill="none" stroke="white" stroke-width="3"/><text x="50" y="58" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="27" font-weight="700">${abbr}</text></svg>`);
});
