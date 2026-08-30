// Electrician Service Data

const electricians = [
    {
        id: 1,
        name: "Ravi Kumar",
        service: "Home Electrical Repair",
        experience: "5 Years Experience",
        rating: "4.8 ⭐",
        price: "₹299 onwards",
        image: "electrician1.jpg"
    },
    {
        id: 2,
        name: "Suresh Electricals",
        service: "Wiring & Installation",
        experience: "8 Years Experience",
        rating: "4.9 ⭐",
        price: "₹499 onwards",
        image: "electrician2.jpg"
    },
    {
        id: 3,
        name: "Sai Electrical Services",
        service: "Fan, Switch & Light Repair",
        experience: "4 Years Experience",
        rating: "4.7 ⭐",
        price: "₹199 onwards",
        image: "electrician3.jpg"
    },
    {
        id: 4,
        name: "Venkat Electric Works",
        service: "AC & Appliance Electrical Work",
        experience: "10 Years Experience",
        rating: "5 ⭐",
        price: "₹599 onwards",
        image: "electrician4.jpg"
    }
];


// Get container from electrician.html

const electricianContainer = document.getElementById("electrician-container");


if (electricianContainer) {

    electricians.forEach((electrician) => {

        electricianContainer.innerHTML += `

        <div class="service-card">

            <img src="${electrician.image}" alt="Electrician">

            <h3>${electrician.name}</h3>

            <p>${electrician.service}</p>

            <p>${electrician.experience}</p>

            <p>${electrician.rating}</p>

            <h4>${electrician.price}</h4>

            <button onclick="bookElectrician(${electrician.id})">
                Book Now
            </button>

        </div>

        `;

    });

}


// Booking Function

function bookElectrician(id) {

    const selectedElectrician = electricians.find(
        (item) => item.id === id
    );


    localStorage.setItem(
        "selectedService",
        JSON.stringify(selectedElectrician)
    );


    window.location.href = "booking.html";

}
function addToCart(name,price){


let cart =
JSON.parse(localStorage.getItem("cart")) || [];



cart.push({

name:name,

price:Number(price)

});



localStorage.setItem(

"cart",

JSON.stringify(cart)

);

alert(name+" added to cart");


}