-- Move a company to a street-level coordinate.
-- Safe to re-run; mirrored into schema.sql for fresh projects.
--
-- Exists so that "set the coordinates" and "recompute the area" cannot come
-- apart. `area` is derived from the point by ez_area(); a caller that updated
-- latitude/longitude and forgot the area would leave the map's region bubbles
-- disagreeing with the pins they contain, silently.
--
-- Called by the `geocode` Edge Function, which validates the point BEFORE
-- calling: inside Georgia, and within 40km of the town centre already on file.
-- Do not treat this function as the validation layer -- it deliberately trusts
-- its caller, and is only reachable by the service role.

create or replace function set_company_point(p_id uuid, p_lat double precision, p_lon double precision)
returns void
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  update companies
     set latitude      = p_lat,
         longitude     = p_lon,
         geo_precision = 'address',
         area          = ez_area(p_lat, p_lon)
   where id = p_id;
end;
$$;

-- Nobody but the service role. This rewrites shared records and does its own
-- trusting, so it must not be reachable from a browser session.
revoke execute on function set_company_point(uuid, double precision, double precision)
  from anon, authenticated, public;
