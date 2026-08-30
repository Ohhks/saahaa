// ================= CARPENTER SERVICES =================


const carpenterServices = [

    {
        name: "Door Repair",
        price: "₹299"
    },

    {
        name: "Furniture Repair",
        price: "₹499"
    },

    {
        name: "Furniture Assembly",
        price: "₹399"
    },

    {
        name: "Wood Work",
        price: "₹699"
    },

    {
        name: "Table Repair",
        price: "₹299"
    },

    {
        name: "Modular Furniture",
        price: "₹1499"
    }

];





// ================= SELECT SERVICE =================


const serviceButtons =
document.querySelectorAll(".service-card button");



serviceButtons.forEach((button,index)=>{


    button.addEventListener("click",()=>{


        let selectedService =
        carpenterServices[index];



        localStorage.setItem(

            "selectedService",

            JSON.stringify(selectedService)

        );



        alert(
            selectedService.name + " Selected"
        );


    });


});






// ================= SELECT PACKAGE =================



const packageButtons =
document.querySelectorAll(".package-card button");



packageButtons.forEach((button)=>{


    button.addEventListener("click",()=>{


        let packageName =
        button.parentElement.querySelector("h3").innerText;



        let packagePrice =
        button.parentElement.querySelector("h2").innerText;




        let selectedPackage = {

            name: packageName,

            price: packagePrice

        };




        localStorage.setItem(

            "selectedPackage",

            JSON.stringify(selectedPackage)

        );



        alert(
            packageName + " Selected"
        );


    });


});







// ================= BOOKING FORM =================



const bookingForm =
document.querySelector(".booking-form");



bookingForm.addEventListener("submit",(event)=>{


    event.preventDefault();



    let bookingDetails = {


        customerName:
        bookingForm.children[0].value,


        mobile:
        bookingForm.children[1].value,


        address:
        bookingForm.children[2].value,


        date:
        bookingForm.children[4].value,


        time:
        bookingForm.children[6].value,


        payment:
        document.querySelector(
        'input[name="payment"]:checked'
        ).parentElement.innerText


    };





    localStorage.setItem(

        "bookingDetails",

        JSON.stringify(bookingDetails)

    );





    alert(
        "Carpenter Booking Confirmed!"
    );





    window.location.href="booking.html";


});







// ================= HERO BUTTON =================


const heroButton =
document.querySelector(".hero button");



heroButton.addEventListener("click",()=>{


    document.querySelector(".booking-form")
    .scrollIntoView({

        behavior:"smooth"

    });


});
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







// ================= EMERGENCY CALL =================


const callButton =
document.querySelector(".support-card button");



callButton.addEventListener("click",()=>{


    window.location.href =
    "tel:+919876543210";


});