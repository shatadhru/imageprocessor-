const path = require("path");
const fs = require("fs");

const folderPath = "../assets/output-Image"


const ImageNameToArrayConverter = (folder) => {

    const files = fs.readdirSync(folder);

    console.log(files)


}


ImageNameToArrayConverter(folderPath);




