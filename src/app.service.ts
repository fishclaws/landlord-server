import { Injectable } from '@nestjs/common';
import { groupBy } from './util';
import { DataSource } from 'typeorm';
import { AddressParser } from '@sroussey/parse-address'
import { searchBusinessQuery } from './queries/searchbusiness';
const addressParser = new AddressParser("us")
var parseFullName = require('parse-full-name').parseFullName;

@Injectable()
export class AppService {
  async searchAddress(query: string, dataSource: DataSource): Promise<SearchResult> {
    query = query.replace('\'', '')

    var addresses = await dataSource.query(
      `SELECT * FROM (
        SELECT *, SIMILARITY(address_full,'${query}') as sim  FROM addresses 
          WHERE starts_with(property_id, 'R') 
          ORDER BY sim DESC LIMIT 5) as addresses
       JOIN property_owners po ON addresses.property_id = po.property_id
       JOIN locations l ON addresses.property_id = l.property_id`
    )


    const reduced: Map<string, any> = groupBy(addresses, "property_id")

    let found = null


    if (Object.keys(reduced).length != 1) {
      // More than one addresses matched

      for (let key of Object.keys(reduced)) {
        if ((reduced as any)[key][0].sim === 1) {
          found = key
        }
      }

      if (!found) {
        return {
          type: 'multiple-addresses',
          addresses: reduced
        };
      }
    }

    var property_id = found || Object.keys(reduced)[0]

    const property = (reduced as any)[property_id][0]


    console.log(addressParser)
    const search_address = addressParser.parseLocation(property.address_full + " " + property.jurisdiction_name + " " + property.state + " " + property.zip_code)
    const owner_address = addressParser.parseLocation(property.owner_address)

    console.log(search_address)
    console.log(owner_address)
    if (search_address.number === owner_address.number &&
      search_address.prefix === owner_address.prefix &&
      search_address.street === owner_address.street &&
      search_address.type === owner_address.type) {
      property['lived_in_by_owner'] = true
      return {
        type: 'no-landlord',
        property
      };
    }


    // Here we can check if the property owner's address is similar to the address of the search

    // ...

    let ownerString: string = property.owner.replaceAll('\'', '')

    let results = await this.searchBusinesses([ownerString], dataSource)
    console.log(results)
    if (results.length == 0 || !results[0].json_build_object.business_owners) {
      if(ownerString.includes("&")) {
        const ownerStrings = ownerString.split("&").map(str => str.trim())
        results = await this.searchBusinesses(ownerStrings, dataSource)
        console.log(results)
      }
    }

    if (results.length == 0 || !results[0].json_build_object.business_owners) {
      if (!ownerString.includes("LLC")) {
        ownerString += " LLC"
        results = await this.searchBusinesses([ownerString], dataSource)
      }
    }

    // At this point we have the property_id and "owner"
    

    if (results.length == 0 || !results[0].json_build_object.business_owners) {
      // No businesses found, search for owner address instead
      let shortened_address = ''
      if (owner_address.number) {
        shortened_address += owner_address.number + ' '
      }
      if (owner_address.prefix) {
        shortened_address += owner_address.prefix + ' '
      }
      if (owner_address.street) {
        shortened_address += owner_address.street + ' '
      }
      if (owner_address.type) {
        shortened_address += owner_address.type + ' '
      }

      shortened_address = shortened_address.toUpperCase()
      shortened_address.replaceAll('\'', '')
      const ownerStringNoLLC = ownerString.replace(' LLC', '')
      const keys = [ownerStringNoLLC, ownerString, shortened_address]
      let property_results = await this.searchPropertyOwnersNoBusiness(dataSource, keys)
        
      if (property_results.length == 0) {
        return {
          type: 'no-landlord', 
          property
        }
      } else {
        const data = property_results[0].json_build_object
        return {
          type: 'no-businesses',
          data,
          property
        };
      }
    }

    const data = results[0].json_build_object
    return {
      type: 'found-business',
      data,
      property
    }

  }

  async searchBusinesses(ownerString: string[], dataSource: DataSource) {
    const queryRunner = dataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.manager.query(`SET pg_trgm.similarity_threshold = 0.8;`)
    const result =  await queryRunner.manager.query(searchBusinessQuery, [ownerString])
    await queryRunner.release()
    return result;

  }

  getHello(): string {
    return 'Hello World!';
  }

  async searchLandlord(query: string, dataSource: DataSource): Promise<SearchResult> {
    const name = parseFullName(query)
    const first_name = name.first
    const middle_name = name.middle
    const last_name = name.last

    return await dataSource.query(
    `WITH found_names AS (
        SELECT *
        FROM business_names
        WHERE 
      SIMILARITY(name, '${first_name}${middle_name ? ' ' + middle_name : ''} ${last_name}') > 0.95 OR
      (first_name = '${first_name}' AND last_name = '${last_name}')
    ),
    related_businesses AS (
        SELECT DISTINCT related.*
        FROM found_names fns
        LEFT JOIN businesses b ON fns.reg_num = b.reg_num
        LEFT JOIN businesses related ON (related.reg_num = fns.reg_num OR related.reg_num = fns.parent_num OR b.place_of_bus_1 = related.place_of_bus_1)
    ),
    owned_addresses AS (
        SELECT DISTINCT a.*, po.owner
        FROM related_businesses related
        LEFT JOIN property_owners po ON
        related.matched_property_owner = po.owner OR
        replace(replace(replace(related.business_name, '.', ''), ',', ''), '''', '') = po.owner OR
    po.owner LIKE '%${first_name} ${last_name}%' OR po.owner LIKE '%${last_name},${first_name}%' OR 
          word_similarity(po.owner, '${query}') > .9
        LEFT JOIN addresses a ON po.property_id = a.property_id
        WHERE a.unit IS NULL
    ),
    locations AS (
        SELECT DISTINCT l.*
        FROM owned_addresses a
        LEFT JOIN locations l ON l.property_id = a.property_id
        WHERE l.property_id is NOT NULL
    )
    SELECT json_build_object(
        'names', json_agg(DISTINCT(bn)),
        'business_owner', json_agg(DISTINCT(found_names)),
        'related_businesses', json_agg(DISTINCT(related)),
        'owned_addresses', json_agg(DISTINCT(a)),
        'locations', json_agg(DISTINCT(l))
    )
    FROM found_names
    LEFT JOIN business_names bn ON found_names.reg_num = bn.reg_num
    LEFT JOIN related_businesses related ON true
    LEFT JOIN owned_addresses a ON true
    LEFT JOIN locations l ON true`)

  }

  async searchPropertyOwnersNoBusiness(dataSource: DataSource, keys: string[]) {
    return await dataSource.query(`			
    WITH owned_addresses AS (
      SELECT DISTINCT a.*, po.owner
          FROM property_owners po
        LEFT JOIN addresses a ON po.property_id = a.property_id
      WHERE 
        (
        po.owner LIKE replace(replace(replace($1, '.', ''), ',', ''), '''', '') || '%' OR
        SIMILARITY(replace(replace(replace($2, '.', ''), ',', ''), '''', ''), po.owner) > 0.85 OR
        po.owner_address LIKE $3 || ' %' --OR
        --SIMILARITY(replace(replace(replace($3, '.', ''), ',', ''), '''', ''), po.owner_address) > 0.85
        ) AND
          a.unit IS NULL
      ),
    unit_counts AS (
      SELECT jsonb_object_agg(units."property_id", "c") as unit_count_map
      FROM
      (
        SELECT ad.property_id, COUNT(ad) as c
        FROM addresses ad
        WHERE EXISTS(SELECT * FROM owned_addresses WHERE property_id = ad.property_id) AND ad.unit IS NOT NULL
        GROUP BY ad.property_id
      ) units
      LIMIT 1
    )
    ,
      address_locations AS (
          SELECT DISTINCT l.*
          FROM owned_addresses a
          LEFT JOIN locations l ON l.property_id = a.property_id
          WHERE l.property_id is NOT NULL
      ),
    eviction_data AS (
      SELECT DISTINCT(e.*)
      FROM (
        --SELECT business_name FROM related_businesses 
  -- 			UNION 
  -- 			SELECT owner from owned_addresses
  -- 			UNION
  -- 			SELECT bn_name from related_businesses
  -- 			UNION
  -- 			SELECT bn2_name from related_businesses
        --UNION
        SELECT DISTINCT (owner) as name from owned_addresses
      ) rb
      INNER JOIN evicting_landlords el ON similarity(el.landlord, rb.name) > .8
      JOIN evictions e ON el.case_code = e.case_code
      WHERE e.case_code is NOT NULL
    ),
    owned_addresses_result AS (
      SELECT jsonb_agg(DISTINCT(a)) as addresses_object
      FROM owned_addresses a
      LIMIT 1
    ),
    locations_result AS (
      SELECT jsonb_agg(DISTINCT(l)) as locations_object
      FROM address_locations l
      LIMIT 1
    ),
    eviction_result AS (
      SELECT COALESCE(jsonb_agg(DISTINCT(ed)) FILTER (WHERE case_code IS NOT NULL), '[]') as evictions_object
      FROM eviction_data ed
      LIMIT 1
    )
    SELECT json_build_object(
          'business_owner', NULL,
          'related_businesses', NULL,
          'owned_addresses', ar.addresses_object,
          'locations', lr.locations_object,
          'hierarchy_nodes', NULL,
          'evictions', er.evictions_object,
          'unit_counts', uc.unit_count_map,
          'businesses_with_same_owners', NULL
      )
      FROM owned_addresses_result ar
      LEFT JOIN locations_result lr ON true
    LEFT JOIN eviction_result er ON true
    LEFT JOIN unit_counts uc ON true
      GROUP BY er.evictions_object, lr.locations_object, ar.addresses_object, uc.unit_count_map
    LIMIT 1;

  `, keys);
  }

}


