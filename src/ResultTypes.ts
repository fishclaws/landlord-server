interface PropertyAddress {
    objectid: string
    property_id: string
    address_id: string
    address_full: string
    unit: string
    unit_type: string
    mail_city: string
    jurisdiction_name: string
    state: string
    zip_code: string
    county: string
    address_type: string
    building_id: string
    simplified_address: string
  }
  
  interface PropertyLocation {
    property_id: string
    latitude: string
    longitude: string
    mercator_x: string
    mercator_y: string
  }
  
  interface Name {
    reg_num: string
    name_type: string
    first_name: string
    middle_name: string
    last_name: string
    addr_1: string
    addr_2: string
    parent_num: string
    name: string
  }
  
  interface BusinessOwner {
    sim: number
    reg_num: string
    business_name: string
    mailing_address_1: string
    place_of_bus_1: string
    name_history: Array<string>
    mailing_address_2: string
    place_of_bus_2: string
  }

  interface BusinessMember {
    name: string | null;
    addr_1: string;
    addr_2: string | null;
    reg_num: string;
    last_name: string | null;
    name_type: string;
    first_name: string | null;
    parent_num: string | null;
    middle_name: string | null;
  }

  interface HierarchyNode {
    reg_num: string;
    business_name: string;
    child_reg_nums: string[];
    business_members: BusinessMember[];
  }

  interface Eviction {
    zip: string;
    city: string;
    county: string;
    status: string;
    case_code: string;
    filed_date: string;
    directional: string;
    case_description: string;
    evicting_landlords: string[];
    evicting_property_managers: string[] | null;
  }

  interface UnitCounts {
    [property_id: string]: number;
  }
  
  interface DataResult {
    business_owner: BusinessOwner
    related_businesses: Array<BusinessOwner>
    owned_addresses: Array<PropertyAddress>
    locations: Array<PropertyLocation>
    hierarchy_nodes: Array<HierarchyNode>
    evictions: Array<Eviction>
    unit_counts: UnitCounts;
  }
  
  class PropertyResult {
    objectid: string
    property_id: string
    address_id: string
    address_full: string
    unit: string
    unit_type: string
    mail_city: string
    jurisdiction_name: string
    state: string
    zip_code: string
    county: string
    address_type: string
    building_id: string
    simplified_address: string
    sim: number
    owner: string
    owner_address: string
    description: string
    owner_name: null
    landlord_id: null
    latitude: string
    longitude: string
  }
  
  interface FoundBusiness {
    type: 'found-business'
    data: DataResult
    property: PropertyResult
  }
  
  interface NoBusinessFound {
    type: 'no-businesses'
    data: DataResult
    property: PropertyResult
  }
  
  interface NoLandlordFound {
    type: 'no-landlord'
    property: PropertyResult
  }
  
  interface MultipleAddresses {
    type: 'multiple-addresses'
    addresses: any
  }
  
  type SearchResult = MultipleAddresses | NoLandlordFound | NoBusinessFound | FoundBusiness

  interface OneLandlordFound {
    data: DataResult
  }

  type LandlordResult = null | OneLandlordFound
