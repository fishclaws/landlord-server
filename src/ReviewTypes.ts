import { ArrayMaxSize, IsArray, IsString, Length } from "class-validator";

export class Landlord {
    @IsString()
    @Length(2, 256)
    name: string;

    @IsString()
    @Length(2, 64)
    origin: string;
}

export class Review {
    @IsArray()
    @ArrayMaxSize(30)
    answersSelected: (number | null)[];
    
    @IsArray()
    landlordList: Landlord[]
    
    @IsString()
    @Length(0, 300)
    reviewText: string;

    @IsString()
    @Length(2, 64)
    address: string;

    @IsString()
    @Length(2, 20)
    propertyId: string;
}
