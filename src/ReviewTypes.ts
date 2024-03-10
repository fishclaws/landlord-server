export interface Landlord {
    name: string,
    origin: string
}

export interface Review {
    answersSelected: (number | null)[];
    landlordList: Landlord[]
    reviewText: string;
    address: string;
}
