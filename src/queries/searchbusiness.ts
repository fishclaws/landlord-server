export const searchBusinessQuery = 
`WITH 
search_terms AS (
    SELECT * FROM unnest($1::text[]) as search_term
),
business_owner AS (
  SELECT *
  FROM businesses
  JOIN search_terms st ON TRUE
  WHERE replace(replace(replace(business_name, '.', ''), ',', ''), '''', '') % st.search_term
  ORDER BY (1 - (replace(replace(replace(business_name, '.', ''), ',', ''), '''', '') <-> st.search_term)) DESC
),
chains AS (
  SELECT jsonb_agg(levels) as levels, top_reg_num, top_last_name, top_first_name FROM (
    WITH RECURSIVE chain(from_reg_num, to_reg_num, to_name, first_name, middle_name, last_name, bus_name, name_type, level) AS (
      SELECT NULL::varchar, bo.reg_num::varchar, NULL::varchar, NULL::varchar, NULL::varchar, NULL::varchar, NULL::varchar, NULL::varchar, 0 as level
      FROM business_owner bo	
      GROUP BY bo.reg_num
      UNION
      SELECT bn.reg_num, bn.parent_num, bn.name, bn.first_name, bn.middle_name, bn.last_name, bus.business_name, bn.name_type, level + 1
      FROM chain c
      LEFT OUTER JOIN businesses bus ON bus.reg_num = to_reg_num AND NOT EXISTS (
          -- Excluding duplicate businesses that start with "0..."
          SELECT * FROM businesses b2 WHERE b2.reg_num != bus.reg_num AND b2.reg_num = LTRIM(bus.reg_num, '0')
      )
      LEFT OUTER JOIN business_names bn ON (
        (
            (to_reg_num IS NOT NULL AND bn.reg_num = to_reg_num)
            OR
            (to_name IS NOT NULL AND
            bn.reg_num IN (
              SELECT reg_num FROM businesses WHERE business_name = to_name
            ))
        ) AND NOT EXISTS (
            -- Excluding duplicate business_names that start with "0..."
            SELECT * FROM business_names bn2 WHERE bn2.reg_num != bn.reg_num AND bn2.reg_num = LTRIM(bn.reg_num, '0')
        )
      )
      WHERE (c.to_reg_num IS NOT NULL OR c.to_name IS NOT NULL) 
        AND level < 10

    )
    SELECT 
      json_agg(chain.*) as levels, 
      --array_agg(top.name) as top_names,
      top.last_name as top_last_name,
      top.first_name as top_first_name,
      top.from_reg_num as top_reg_num
    FROM chain
    JOIN (
        SELECT 
        --DISTINCT(COALESCE(to_name, last_name || ',' || first_name )) AS name,
        last_name,
        first_name,
        chain.from_reg_num
        FROM chain 
        WHERE level = (
            SELECT level 
            FROM chain 
            ORDER BY level DESC LIMIT 1)
    ) as top ON TRUE
    WHERE level != 0
    GROUP BY level, top.from_reg_num, top.last_name, top.first_name
    ORDER BY chain.level
  )
    GROUP BY top_reg_num, top_last_name, top_first_name
),
hierarchy AS (
    SELECT DISTINCT(results.*) FROM (
    WITH RECURSIVE tree(top_reg_num, child_reg_num, reg_num, parent_num, level) AS (
      SELECT ch.top_reg_num::varchar, ch.top_reg_num::varchar, ch.top_reg_num::varchar, NULL::varchar, 0 as level
      FROM chains ch
    UNION ALL
      SELECT
        tr.top_reg_num,
        children.reg_num,
        child_reg_num,
        CASE WHEN (tr.level = 0) THEN NULL ELSE (tr.reg_num) END, -- so parent nodes don't have themselves as parents
        tr.level + 1
      FROM tree tr
      LEFT JOIN businesses bus ON bus.reg_num = tr.child_reg_num 
        AND NOT EXISTS (
          -- Excluding duplicate businesses that start with "0..."
          SELECT * FROM businesses b2 WHERE b2.reg_num != bus.reg_num AND b2.reg_num = LTRIM(bus.reg_num, '0')
      )
      LEFT OUTER JOIN business_names bn ON (
        tr.child_reg_num IS NOT NULL 
        AND bn.reg_num = tr.child_reg_num
        AND NOT EXISTS (
            -- Excluding duplicate business_names that start with "0..."
            SELECT * FROM business_names bn2 WHERE bn2.reg_num != bn.reg_num AND bn2.reg_num = LTRIM(bn.reg_num, '0')
        )
      )
      LEFT OUTER JOIN business_names children ON (
          (children.parent_num = tr.child_reg_num OR children.name = bus.business_name)
          AND children.reg_num != child_reg_num
      ) 
      WHERE (tr.child_reg_num IS NOT NULL) AND 
        tr.level < 10
    )
    SELECT
      tree.top_reg_num,
      tree.reg_num,
      tree.parent_num,
      ARRAY_REMOVE(array_agg(DISTINCT tree.child_reg_num), NULL) as child_reg_nums,
      tree.level
    FROM tree
    WHERE tree.level > 0
    GROUP BY tree.top_reg_num, tree.reg_num, tree.level, tree.parent_num
    ORDER BY tree.level
  ) results
),
businesses_with_same_owners_1 AS (
    SELECT DISTINCT ON(b.business_name) b.*, ch.top_reg_num
    FROM chains ch
    JOIN business_names bn ON bn.first_name = ch.top_first_name AND bn.last_name = ch.top_last_name
    JOIN businesses b ON b.reg_num = bn.reg_num
    WHERE (b.reg_num NOT IN (SELECT reg_num from hierarchy))
    AND NOT EXISTS (
      -- Excluding duplicate businesses that start with "0..."
      SELECT * FROM businesses b2 WHERE b2.reg_num != b.reg_num AND b2.reg_num = LTRIM(b.reg_num, '0')
    )
),
businesses_with_same_owners AS (
    SELECT jsonb_agg(bus) as arr 
    FROM businesses_with_same_owners_1 bus
    LIMIT 1
),
hierarchy_nodes AS (
    SELECT jsonb_build_object(
        'top_reg_num', h.top_reg_num,
        'reg_num', h.reg_num,
        'parent_num', h.parent_num,
        'child_reg_nums', h.child_reg_nums,
        'business_name', bus.business_name,
        'business_members',  array_agg(bn)
    ) AS nodes
    FROM hierarchy h
    JOIN businesses bus ON bus.reg_num = h.reg_num
    LEFT JOIN business_names bn ON bn.reg_num = h.reg_num
    GROUP BY h.top_reg_num, h.reg_num, h.child_reg_nums, bus.business_name, h.parent_num

),
node_member_names AS (
    SELECT DISTINCT CASE WHEN(bn.last_name IS NOT NULL OR bn.first_name IS NOT NULL) 
                THEN (bn.last_name || ',' || bn.first_name) 
                ELSE bn.name
                END as name
    FROM hierarchy h
    JOIN business_names bn ON bn.reg_num = h.reg_num
),
related_businesses AS (
    SELECT DISTINCT ON (reg_num) related.*, bn.last_name || ', ' || bn.first_name as bn_name,  bn2.last_name || ', ' || bn2.first_name as bn2_name 
    FROM business_owner fb
    LEFT JOIN business_names bn ON fb.reg_num = bn.reg_num
    LEFT JOIN business_names bn2 ON bn2.first_name = bn.first_name AND bn2.last_name = bn.last_name
    LEFT JOIN businesses related ON (related.reg_num = bn2.reg_num OR related.reg_num = bn2.parent_num OR fb.place_of_bus_1 = related.place_of_bus_1)
    UNION
    SELECT DISTINCT b.*, bn.last_name || ', ' || bn.first_name as bn_name,  bn.last_name || ', ' || bn.first_name as bn2_name  
    FROM hierarchy hr
    JOIN businesses b ON b.reg_num = hr.reg_num
    LEFT JOIN business_names bn ON hr.reg_num = bn.reg_num
),
owned_addresses AS (
    SELECT DISTINCT a.*, po.owner, po.market_value
    FROM (
        SELECT DISTINCT ON (business_name) * FROM (
            SELECT matched_property_owner, business_name
            FROM related_businesses
            UNION
            SELECT matched_property_owner, business_name
            FROM businesses_with_same_owners_1
        )
    ) related
    LEFT JOIN property_owners po ON
    related.matched_property_owner = po.owner OR
	replace(replace(replace(related.business_name, '.', ''), ',', ''), '''', '') % po.owner
    --replace(replace(replace(related.business_name, '.', ''), ',', ''), '''', '') = po.owner --OR 
    --SIMILARITY(replace(replace(replace(related.business_name, '.', ''), ',', ''), '''', ''), po.owner) > 0.85
    LEFT JOIN addresses a ON po.property_id = a.property_id
    WHERE a.unit IS NULL
),
market_value_sum AS (
	SELECT SUM(values.market_value)
	FROM (SELECT DISTINCT ON (market_value) market_value FROM owned_addresses) AS values
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
		SELECT DISTINCT ON (business_name) * FROM (
            SELECT name as business_name from node_member_names
            UNION
            SELECT business_name FROM related_businesses
        ) WHERE business_name IS NOT NULL
    ) rb
    INNER JOIN evicting_landlords el ON el.landlord % rb.business_name
    INNER JOIN evictions e ON e.case_code = el.case_code
    WHERE e.case_code is NOT NULL
),
business_owner_result AS (
    SELECT jsonb_agg(DISTINCT(bo)) as obj
    FROM business_owner bo
    LIMIT 1
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
hierarchy_result AS (
    SELECT jsonb_agg(result.jsonb_build_object) as nodes_object
    FROM (
        SELECT jsonb_build_object(
            'top_reg_num', subquery.top_reg_num,
            'nodes_array', nodes_array
        )
        FROM (
            SELECT jsonb_agg(DISTINCT(hn.nodes)) as nodes_array, hn.nodes->>'top_reg_num' as top_reg_num
            FROM hierarchy_nodes hn
            GROUP BY hn.nodes->>'top_reg_num'
        ) subquery
    ) result
    LIMIT 1
),
eviction_result AS (
    SELECT COALESCE(jsonb_agg(DISTINCT(ed)) FILTER (WHERE case_code IS NOT NULL), '[]') as evictions_object
    FROM eviction_data ed
    LIMIT 1
)
        
SELECT json_build_object(
    'business_owners', business_owner_result.obj,
    'related_businesses', json_agg(DISTINCT(related)),
    'owned_addresses', ar.addresses_object,
    'locations', lr.locations_object,
    'hierarchy_nodes', hr.nodes_object,
    'evictions', er.evictions_object,
    'unit_counts', uc.unit_count_map,
    'businesses_with_same_owners', bwso.arr,
	'market_value_sum', market_value_sum.sum
)
FROM business_owner_result
LEFT JOIN related_businesses related ON true
LEFT JOIN owned_addresses_result ar ON true
LEFT JOIN locations_result lr ON true
LEFT JOIN hierarchy_result hr ON true
LEFT JOIN eviction_result er ON true
LEFT JOIN unit_counts uc ON true
LEFT JOIN businesses_with_same_owners bwso ON true
LEFT JOIN market_value_sum ON true
GROUP BY business_owner_result.obj, hr.nodes_object,  lr.locations_object, ar.addresses_object, uc.unit_count_map, bwso.arr, er.evictions_object,market_value_sum.sum
LIMIT 1;
`